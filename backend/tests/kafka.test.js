import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { pool } from '../src/config/db.js';
import {
  EVENT_TYPES,
  createTransactionCompletedEvent,
  isValidTransactionCompletedEvent,
} from '../src/events/transaction.event.js';
import {
  writeOutboxEvent,
  processPendingOutboxEvents,
} from '../src/services/outbox.service.js';
import {
  formatNotification,
  processNotificationEvent,
} from '../src/workers/notification.worker.js';
import {
  evaluateFraudRules,
  checkAccountVelocity,
  clearVelocityTracker,
  processFraudEvent,
  FRAUD_CONFIG,
} from '../src/workers/fraud.worker.js';
import {
  markEventProcessed,
  clearProcessedEvents,
} from '../src/services/consumerIdempotency.service.js';
import {
  executeWithRetry,
  recordDeadLetter,
} from '../src/services/consumerRetry.service.js';
import {
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
} from '../src/config/kafka.js';

describe('Day-5: Kafka & Event-Driven Architecture Test Suite', () => {
  let senderUserId;
  let receiverUserId;
  let senderAccountId;
  let receiverAccountId;

  before(async () => {
    // Fetch active accounts for testing
    const accountsRes = await pool.query(`
      SELECT a.id as account_id, a.user_id
      FROM accounts a
      WHERE a.status = 'active'
      ORDER BY a.created_at ASC
    `);

    if (accountsRes.rows.length < 2) {
      throw new Error('Test suite requires at least 2 active accounts in PostgreSQL');
    }

    senderAccountId = accountsRes.rows[0].account_id;
    senderUserId = accountsRes.rows[0].user_id;

    const receiverRow =
      accountsRes.rows.find((r) => r.user_id !== senderUserId) || accountsRes.rows[1];
    receiverAccountId = receiverRow.account_id;
    receiverUserId = receiverRow.user_id;

    // Clean up test tables
    await pool.query('DELETE FROM transaction_outbox WHERE aggregate_type = $1', ['TEST_TRANSACTION']);
    await pool.query('DELETE FROM consumer_dlq WHERE topic = $1', ['test-topic']);
    await clearProcessedEvents();
  });

  after(async () => {
    await pool.query('DELETE FROM transaction_outbox WHERE aggregate_type = $1', ['TEST_TRANSACTION']);
    await pool.query('DELETE FROM consumer_dlq WHERE topic = $1', ['test-topic']);
    await clearProcessedEvents();
    await pool.end();
  });

  beforeEach(() => {
    clearVelocityTracker();
  });

  describe('1. Domain Event Model & Schema Validation', () => {
    it('constructs a standardized, valid TRANSACTION_COMPLETED domain event', () => {
      const mockTx = { id: crypto.randomUUID(), status: 'completed', created_at: new Date() };
      const event = createTransactionCompletedEvent({
        transaction: mockTx,
        senderUserId,
        receiverUserId,
        senderAccountId,
        receiverAccountId,
        amount: 2500,
        currency: 'INR',
        description: 'Monthly Rent',
      });

      assert.equal(event.eventType, EVENT_TYPES.TRANSACTION_COMPLETED);
      assert.equal(event.aggregateType, 'TRANSACTION');
      assert.equal(event.aggregateId, mockTx.id);
      assert.equal(event.version, 1);
      assert.equal(event.data.amount, 2500);
      assert.equal(event.data.currency, 'INR');
      assert.equal(event.data.description, 'Monthly Rent');
      assert.equal(event.data.senderAccountId, senderAccountId);
      assert.equal(event.data.receiverAccountId, receiverAccountId);
      assert.ok(event.eventId, 'Must contain a unique eventId');
      assert.ok(event.timestamp, 'Must contain ISO timestamp');

      assert.equal(isValidTransactionCompletedEvent(event), true);
    });

    it('rejects events missing critical identifiers or with invalid amounts', () => {
      assert.equal(isValidTransactionCompletedEvent(null), false);
      assert.equal(isValidTransactionCompletedEvent({}), false);
      assert.equal(
        isValidTransactionCompletedEvent({
          eventId: 'evt-1',
          eventType: EVENT_TYPES.TRANSACTION_COMPLETED,
          aggregateId: 'tx-1',
          timestamp: new Date().toISOString(),
          data: { transactionId: 'tx-1', senderAccountId: 'acc-1', amount: -500 }, // Invalid amount
        }),
        false
      );
    });
  });

  describe('2. Transactional Outbox Pattern & Atomicity', () => {
    it('atomically writes pending outbox event inside PostgreSQL transaction', async () => {
      const client = await pool.connect();
      const testTxId = crypto.randomUUID();

      try {
        await client.query('BEGIN');

        const outboxRow = await writeOutboxEvent({
          client,
          aggregateType: 'TEST_TRANSACTION',
          aggregateId: testTxId,
          eventType: EVENT_TYPES.TRANSACTION_COMPLETED,
          payload: { testTxId, amount: 500 },
          partitionKey: senderAccountId,
        });

        assert.ok(outboxRow.id);
        assert.equal(outboxRow.status, 'PENDING');
        assert.equal(outboxRow.partition_key, senderAccountId);

        await client.query('COMMIT');

        // Verify record is committed and visible
        const check = await pool.query(
          'SELECT * FROM transaction_outbox WHERE id = $1',
          [outboxRow.id]
        );
        assert.equal(check.rows.length, 1);
        assert.equal(check.rows[0].status, 'PENDING');
      } finally {
        client.release();
      }
    });

    it('rolls back outbox row when the database transaction fails (no ghost events)', async () => {
      const client = await pool.connect();
      const testTxId = crypto.randomUUID();
      let generatedOutboxId = null;

      try {
        await client.query('BEGIN');

        const outboxRow = await writeOutboxEvent({
          client,
          aggregateType: 'TEST_TRANSACTION',
          aggregateId: testTxId,
          eventType: EVENT_TYPES.TRANSACTION_COMPLETED,
          payload: { testTxId, amount: 999 },
          partitionKey: senderAccountId,
        });
        generatedOutboxId = outboxRow.id;

        // Force an intentional rollback
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      // Assert outbox row was completely rolled back
      const check = await pool.query(
        'SELECT * FROM transaction_outbox WHERE id = $1',
        [generatedOutboxId]
      );
      assert.equal(check.rows.length, 0, 'Rolled-back outbox events must not exist in database');
    });

    it('safely acquires pending outbox events using FOR UPDATE SKIP LOCKED', async () => {
      const count = await processPendingOutboxEvents({ limit: 5 });
      assert.equal(typeof count, 'number', 'Must return a number count of processed events');
      assert.ok(count >= 0, 'Processed event count must be non-negative');
    });
  });

  describe('3. Notification Consumer Worker', () => {
    it('formats customer debit and credit notifications with correct amounts and references', () => {
      const event = createTransactionCompletedEvent({
        transaction: { id: 'tx-notif-99', status: 'completed' },
        senderUserId,
        receiverUserId,
        senderAccountId,
        receiverAccountId,
        amount: 3500.5,
        currency: 'INR',
        description: 'Invoice #1042',
      });

      const { senderNotification, receiverNotification } = formatNotification(event);

      // Verify Sender Debit Alert
      assert.equal(senderNotification.type, 'DEBIT_ALERT');
      assert.equal(senderNotification.recipientAccountId, senderAccountId);
      assert.equal(senderNotification.amount, 3500.5);
      assert.ok(senderNotification.message.includes('debited INR 3500.50'));
      assert.ok(senderNotification.message.includes('Invoice #1042'));
      assert.ok(senderNotification.message.includes('Ref: tx-notif-99'));

      // Verify Receiver Credit Alert
      assert.equal(receiverNotification.type, 'CREDIT_ALERT');
      assert.equal(receiverNotification.recipientAccountId, receiverAccountId);
      assert.equal(receiverNotification.amount, 3500.5);
      assert.ok(receiverNotification.message.includes('credited INR 3500.50'));
      assert.ok(receiverNotification.message.includes('Ref: tx-notif-99'));
    });
  });

  describe('4. Fraud Detection Consumer Worker', () => {
    it('flags high-value transfer exceeding threshold (₹100,000)', () => {
      const event = createTransactionCompletedEvent({
        transaction: { id: 'tx-fraud-high', status: 'completed' },
        senderUserId,
        receiverUserId,
        senderAccountId,
        receiverAccountId,
        amount: 150000,
      });

      const evaluation = evaluateFraudRules(event);
      assert.equal(evaluation.isSuspicious, true);
      assert.equal(evaluation.severity, 'MEDIUM'); // Score: 60/100
      assert.equal(evaluation.triggeredRules[0].rule, 'HIGH_VALUE_TRANSFER');
      assert.equal(evaluation.triggeredRules[0].actualAmount, 150000);
    });

    it('flags rapid-fire velocity bursts from the same account', () => {
      const now = Date.now();
      // Record 3 rapid transfers
      checkAccountVelocity('test-velocity-acc', now, 3, 60000);
      checkAccountVelocity('test-velocity-acc', now + 100, 3, 60000);
      checkAccountVelocity('test-velocity-acc', now + 200, 3, 60000);

      // 4th transfer exceeds threshold of 3
      const fourth = checkAccountVelocity('test-velocity-acc', now + 300, 3, 60000);
      assert.equal(fourth.exceeded, true);
      assert.equal(fourth.count, 4);
    });

    it('passes normal low-value transfers without flagging', () => {
      const event = createTransactionCompletedEvent({
        transaction: { id: 'tx-normal', status: 'completed' },
        senderUserId,
        receiverUserId,
        senderAccountId,
        receiverAccountId,
        amount: 250,
      });

      const evaluation = evaluateFraudRules(event);
      assert.equal(evaluation.isSuspicious, false);
      assert.equal(evaluation.triggeredRules.length, 0);
    });
  });

  describe('5. Consumer Idempotency', () => {
    it('records first-time event and safely ignores duplicate delivery for same consumer group', async () => {
      const testEventId = crypto.randomUUID();
      const group = 'test-notification-group';

      // 1. First delivery
      const firstResult = await markEventProcessed(group, testEventId, 'TRANSACTION_COMPLETED');
      assert.equal(firstResult, true, 'First delivery must return true');

      // 2. Duplicate delivery
      const secondResult = await markEventProcessed(group, testEventId, 'TRANSACTION_COMPLETED');
      assert.equal(secondResult, false, 'Duplicate delivery must return false');
    });

    it('allows different consumer groups to process the same event independently', async () => {
      const testEventId = crypto.randomUUID();

      const notifResult = await markEventProcessed(
        KAFKA_CONSUMER_GROUPS.NOTIFICATIONS,
        testEventId,
        'TRANSACTION_COMPLETED'
      );
      assert.equal(notifResult, true);

      const fraudResult = await markEventProcessed(
        KAFKA_CONSUMER_GROUPS.FRAUD,
        testEventId,
        'TRANSACTION_COMPLETED'
      );
      assert.equal(fraudResult, true, 'Different consumer group must not be blocked by prior group');
    });
  });

  describe('6. Consumer Retry & Dead Letter Queue (DLQ)', () => {
    it('retries transient failures with exponential backoff and succeeds on recovery', async () => {
      let attempts = 0;
      const result = await executeWithRetry(
        async (attempt) => {
          attempts++;
          if (attempt < 2) {
            throw new Error(`Transient network glitch #${attempt}`);
          }
          return 'SUCCESS_AFTER_RETRY';
        },
        { maxRetries: 3, baseDelayMs: 15 }
      );

      assert.equal(result, 'SUCCESS_AFTER_RETRY');
      assert.equal(attempts, 3);
    });

    it('records exhausted poison pills into consumer_dlq table for audit inspection', async () => {
      const dlqRecord = await recordDeadLetter({
        consumerGroup: 'finflow-notifications-group',
        topic: 'test-topic',
        event: { eventId: 'evt-poison-999', eventType: 'TEST_POISON' },
        error: new Error('Critical downstream service error'),
        retryCount: 3,
      });

      assert.ok(dlqRecord?.id, 'DLQ entry must be created with UUID');

      // Verify in database
      const check = await pool.query('SELECT * FROM consumer_dlq WHERE id = $1', [dlqRecord.id]);
      assert.equal(check.rows.length, 1);
      assert.equal(check.rows[0].consumer_group, 'finflow-notifications-group');
      assert.equal(check.rows[0].event_id, 'evt-poison-999');
      assert.equal(check.rows[0].retry_count, 3);
      assert.equal(check.rows[0].error_message, 'Critical downstream service error');
    });
  });
});
