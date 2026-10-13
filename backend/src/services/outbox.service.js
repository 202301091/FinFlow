import { pool } from '../config/db.js';
import { kafkaProducer, connectProducer, isKafkaAvailable, KAFKA_TOPICS } from '../config/kafka.js';
import logger from '../config/logger.js';

export const writeOutboxEvent = async ({
  client,
  aggregateType = 'TRANSACTION',
  aggregateId,
  eventType,
  payload,
  partitionKey,
}) => {
  if (!client || typeof client.query !== 'function') {
    throw new Error('[Outbox] Active transaction client is required to write outbox event');
  }
  if (!aggregateId || !eventType || !payload || !partitionKey) {
    throw new Error('[Outbox] aggregateId, eventType, payload, and partitionKey are required');
  }

  const result = await client.query(
    `INSERT INTO transaction_outbox (
       aggregate_type,
       aggregate_id,
       event_type,
       payload,
       partition_key,
       status
     ) VALUES ($1, $2, $3, $4, $5, 'PENDING')
     RETURNING *`,
    [aggregateType, aggregateId, eventType, JSON.stringify(payload), String(partitionKey)]
  );

  return result.rows[0];
};

export const publishEventToKafka = async ({
  topic = KAFKA_TOPICS.TRANSACTIONS,
  key,
  event,
}) => {
  try {
    const connected = await connectProducer();
    if (!connected) {
      return false;
    }

    await kafkaProducer.send({
      topic,
      messages: [
        {
          key: String(key),
          value: JSON.stringify(event),
          headers: {
            eventId: event.eventId || '',
            eventType: event.eventType || '',
            timestamp: event.timestamp || new Date().toISOString(),
          },
        },
      ],
    });

    return true;
  } catch (error) {
    logger.warn({ err: error, topic }, `[Outbox] Kafka publication error on topic '${topic}': ${error.message}`);
    return false;
  }
};

export const processPendingOutboxEvents = async ({ limit = 50 } = {}) => {
  const isReady = await connectProducer();
  if (!isReady) {
    return 0;
  }

  const client = await pool.connect();
  let publishedCount = 0;

  try {
    await client.query('BEGIN');

    // Lock pending outbox rows safely
    const selectRes = await client.query(
      `SELECT id, aggregate_id, event_type, payload, partition_key, retry_count
       FROM transaction_outbox
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    const pendingRows = selectRes.rows;
    if (pendingRows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    for (const row of pendingRows) {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

      const success = await publishEventToKafka({
        topic: KAFKA_TOPICS.TRANSACTIONS,
        key: row.partition_key,
        event: payload,
      });

      if (success) {
        await client.query(
          `UPDATE transaction_outbox
           SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [row.id]
        );
        publishedCount++;
      } else {
        // If Kafka is down or failed, increment retry count and stop current batch
        await client.query(
          `UPDATE transaction_outbox
           SET retry_count = retry_count + 1
           WHERE id = $1`,
          [row.id]
        );
        // Do not hammer an unreachable broker in this tick
        break;
      }
    }

    await client.query('COMMIT');
    return publishedCount;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    logger.warn({ err: error }, `[Outbox] Error processing pending outbox batch: ${error.message}`);
    return publishedCount;
  } finally {
    client.release();
  }
};

let relayIntervalId = null;

export const startOutboxRelay = ({ intervalMs = 3000 } = {}) => {
  if (relayIntervalId) return;

  relayIntervalId = setInterval(async () => {
    try {
      await processPendingOutboxEvents({ limit: 50 });
    } catch (err) {
      logger.warn({ err }, `[Outbox Relay] Background tick error: ${err.message}`);
    }
  }, intervalMs);

  if (relayIntervalId.unref) {
    relayIntervalId.unref();
  }
};

export const stopOutboxRelay = () => {
  if (relayIntervalId) {
    clearInterval(relayIntervalId);
    relayIntervalId = null;
  }
};
