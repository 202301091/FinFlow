import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { pool } from '../src/config/db.js';
import { writeOutboxEvent } from '../src/services/outbox.service.js';
import { markEventProcessed, clearProcessedEvents } from '../src/services/consumerIdempotency.service.js';
import { KAFKA_CONSUMER_GROUPS, KAFKA_TOPICS } from '../src/config/kafka.js';

describe('Day-6 Step 10: Kafka Consumer Group Scaling & Partition Guarantees', () => {
  let senderAccountId;
  let receiverAccountId;
  const outboxIds = [];

  before(async () => {
    // 1. Fetch active accounts
    const accRes = await pool.query(`
      SELECT id FROM accounts WHERE status = 'active' LIMIT 2
    `);
    if (accRes.rows.length < 2) {
      throw new Error('Test requires at least 2 active accounts');
    }
    senderAccountId = accRes.rows[0].id;
    receiverAccountId = accRes.rows[1].id;

    await clearProcessedEvents();
  });

  after(async () => {
    // Cleanup created outbox events
    if (outboxIds.length > 0) {
      await pool.query('DELETE FROM transaction_outbox WHERE id = ANY($1)', [outboxIds]);
    }
    await clearProcessedEvents();
    await pool.end();
  });

  it('1. Partition Key Determinism: Events for the same sender account always use the identical partition key', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const event1 = {
        eventId: crypto.randomUUID(),
        eventType: 'TRANSACTION_COMPLETED',
        data: { senderAccountId, amount: 100 },
      };
      const event2 = {
        eventId: crypto.randomUUID(),
        eventType: 'TRANSACTION_COMPLETED',
        data: { senderAccountId, amount: 200 },
      };

      const row1 = await writeOutboxEvent({
        client,
        aggregateType: 'TRANSACTION_SCALING_TEST',
        aggregateId: crypto.randomUUID(),
        eventType: event1.eventType,
        payload: event1,
        partitionKey: senderAccountId,
      });
      outboxIds.push(row1.id);

      const row2 = await writeOutboxEvent({
        client,
        aggregateType: 'TRANSACTION_SCALING_TEST',
        aggregateId: crypto.randomUUID(),
        eventType: event2.eventType,
        payload: event2,
        partitionKey: senderAccountId,
      });
      outboxIds.push(row2.id);

      await client.query('COMMIT');

      // Both events must have identical partition keys for deterministic FIFO partition assignment
      assert.equal(row1.partition_key, senderAccountId);
      assert.equal(row2.partition_key, senderAccountId);
      assert.equal(row1.partition_key, row2.partition_key);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  it('2. Outbox Worker Scaling: Concurrent workers poll non-overlapping batches via FOR UPDATE SKIP LOCKED', async () => {
    // Insert 6 pending events
    const insertClient = await pool.connect();
    const batchEventIds = [];
    try {
      await insertClient.query('BEGIN');
      for (let i = 1; i <= 6; i++) {
        const ev = { eventId: crypto.randomUUID(), seq: i };
        const row = await writeOutboxEvent({
          client: insertClient,
          aggregateType: 'TRANSACTION_SCALING_TEST',
          aggregateId: crypto.randomUUID(),
          eventType: 'TRANSACTION_COMPLETED',
          payload: ev,
          partitionKey: senderAccountId,
        });
        outboxIds.push(row.id);
        batchEventIds.push(row.id);
      }
      await insertClient.query('COMMIT');
    } catch (err) {
      await insertClient.query('ROLLBACK');
      throw err;
    } finally {
      insertClient.release();
    }

    // Simulate two concurrent worker connections querying outbox simultaneously
    const worker1 = await pool.connect();
    const worker2 = await pool.connect();

    try {
      await worker1.query('BEGIN');
      await worker2.query('BEGIN');

      // Worker 1 locks first 3 rows
      const w1Rows = await worker1.query(
        `SELECT id FROM transaction_outbox
         WHERE status = 'PENDING' AND id = ANY($1)
         ORDER BY created_at ASC
         LIMIT 3
         FOR UPDATE SKIP LOCKED`,
        [batchEventIds]
      );

      // Worker 2 concurrently queries for 3 rows; SKIP LOCKED skips Worker 1's locked rows
      const w2Rows = await worker2.query(
        `SELECT id FROM transaction_outbox
         WHERE status = 'PENDING' AND id = ANY($1)
         ORDER BY created_at ASC
         LIMIT 3
         FOR UPDATE SKIP LOCKED`,
        [batchEventIds]
      );

      assert.equal(w1Rows.rows.length, 3, 'Worker 1 should acquire 3 rows');
      assert.equal(w2Rows.rows.length, 3, 'Worker 2 should acquire remaining 3 rows');

      const w1Ids = w1Rows.rows.map((r) => r.id);
      const w2Ids = w2Rows.rows.map((r) => r.id);

      // Verify zero overlap between Worker 1 and Worker 2
      for (const id of w2Ids) {
        assert.ok(!w1Ids.includes(id), `Worker 2 row ${id} must not collide with Worker 1`);
      }

      await worker1.query('COMMIT');
      await worker2.query('COMMIT');
    } catch (err) {
      await worker1.query('ROLLBACK');
      await worker2.query('ROLLBACK');
      throw err;
    } finally {
      worker1.release();
      worker2.release();
    }
  });

  it('3. Consumer Worker Race: Concurrent consumers processing the same event atomically deduplicate', async () => {
    const sharedEventId = crypto.randomUUID();
    const consumerGroup = KAFKA_CONSUMER_GROUPS.NOTIFICATIONS;

    // Simulate 4 concurrent consumer workers racing to process the exact same message
    const results = await Promise.all([
      markEventProcessed(consumerGroup, sharedEventId, 'TRANSACTION_COMPLETED'),
      markEventProcessed(consumerGroup, sharedEventId, 'TRANSACTION_COMPLETED'),
      markEventProcessed(consumerGroup, sharedEventId, 'TRANSACTION_COMPLETED'),
      markEventProcessed(consumerGroup, sharedEventId, 'TRANSACTION_COMPLETED'),
    ]);

    // Exactly ONE consumer should get true (processed), and 3 must get false (duplicate)
    const processedCount = results.filter((r) => r === true).length;
    const skippedCount = results.filter((r) => r === false).length;

    assert.equal(processedCount, 1, 'Exactly 1 worker instance must be granted execution');
    assert.equal(skippedCount, 3, 'Remaining 3 worker instances must safely skip as duplicate');
  });

  it('4. Multi-Group Independent Scaling: Notifications and Fraud consumer groups scale independently', async () => {
    const eventId = crypto.randomUUID();

    // Consumer Group 1: Notifications
    const notifFirst = await markEventProcessed(
      KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
      eventId,
      'TRANSACTION_COMPLETED'
    );
    assert.equal(notifFirst, true, 'Notifications worker must process event');

    // Consumer Group 2: Fraud Analysis (independent consumer group on same topic)
    const fraudFirst = await markEventProcessed(
      KAFKA_CONSUMER_GROUPS.FRAUD,
      eventId,
      'TRANSACTION_COMPLETED'
    );
    assert.equal(fraudFirst, true, 'Fraud worker must process event independently of notifications');

    // Both groups now consider it processed
    const notifSecond = await markEventProcessed(
      KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
      eventId,
      'TRANSACTION_COMPLETED'
    );
    assert.equal(notifSecond, false, 'Notifications duplicate skipped');

    const fraudSecond = await markEventProcessed(
      KAFKA_CONSUMER_GROUPS.FRAUD,
      eventId,
      'TRANSACTION_COMPLETED'
    );
    assert.equal(fraudSecond, false, 'Fraud duplicate skipped');
  });
});
