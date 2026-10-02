import { pool } from '../config/db.js';
import { kafkaProducer, connectProducer, isKafkaAvailable, KAFKA_TOPICS } from '../config/kafka.js';

/**
 * Persist an event into the transaction_outbox table.
 * MUST be executed within an existing PostgreSQL transaction client for atomicity.
 *
 * @param {Object} params
 * @param {import('pg').PoolClient} params.client - Active PostgreSQL transaction client
 * @param {string} [params.aggregateType='TRANSACTION'] - Entity type
 * @param {string} params.aggregateId - UUID of the primary entity
 * @param {string} params.eventType - Event identifier (e.g. 'TRANSACTION_COMPLETED')
 * @param {Object} params.payload - Full domain event payload JSON
 * @param {string} params.partitionKey - Key for Kafka partition routing (e.g. senderAccountId)
 * @returns {Promise<Object>} Created outbox record
 */
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

/**
 * Send a single serialized message directly to a Kafka topic.
 *
 * @param {Object} params
 * @param {string} [params.topic=KAFKA_TOPICS.TRANSACTIONS] - Target Kafka topic
 * @param {string} params.key - Partitioning key
 * @param {Object} params.event - Event object
 * @returns {Promise<boolean>} True if published, false if failed
 */
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
    console.warn(`[Outbox] Kafka publication error on topic '${topic}':`, error.message);
    return false;
  }
};

/**
 * Poll and dispatch pending events from transaction_outbox to Kafka.
 * Uses FOR UPDATE SKIP LOCKED to allow concurrent workers to poll without collision.
 *
 * @param {Object} options
 * @param {number} [options.limit=50] - Maximum records to process per batch
 * @returns {Promise<number>} Number of successfully published events
 */
export const processPendingOutboxEvents = async ({ limit = 50 } = {}) => {
  // If Kafka broker is unavailable, fast-exit to preserve DB resources (circuit breaker)
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
    console.warn('[Outbox] Error processing pending outbox batch:', error.message);
    return publishedCount;
  } finally {
    client.release();
  }
};

let relayIntervalId = null;

/**
 * Start the background Outbox Relay polling service.
 *
 * @param {Object} options
 * @param {number} [options.intervalMs=3000] - Polling interval in milliseconds
 */
export const startOutboxRelay = ({ intervalMs = 3000 } = {}) => {
  if (relayIntervalId) return;

  relayIntervalId = setInterval(async () => {
    try {
      await processPendingOutboxEvents({ limit: 50 });
    } catch (err) {
      console.warn('[Outbox Relay] Background tick error:', err.message);
    }
  }, intervalMs);

  // Prevent background interval from keeping process alive on exit
  if (relayIntervalId.unref) {
    relayIntervalId.unref();
  }
};

/**
 * Stop the background Outbox Relay service.
 */
export const stopOutboxRelay = () => {
  if (relayIntervalId) {
    clearInterval(relayIntervalId);
    relayIntervalId = null;
  }
};
