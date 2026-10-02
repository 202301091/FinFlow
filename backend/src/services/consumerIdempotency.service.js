import { pool } from '../config/db.js';

/**
 * Mark a domain event as processed by a specific consumer group atomically.
 *
 * Uses PostgreSQL ON CONFLICT (consumer_group, event_id) DO NOTHING.
 * - If the record is inserted successfully (rowCount === 1), this is the first time
 *   the consumer group has seen this event -> returns true.
 * - If the record already exists (rowCount === 0), it is a duplicate event -> returns false.
 *
 * @param {string} consumerGroup - Identifier of consumer group (e.g. 'finflow-notifications-group')
 * @param {string} eventId - Unique UUID of the event
 * @param {string} eventType - Type identifier (e.g. 'TRANSACTION_COMPLETED')
 * @param {Object} [client=pool] - Optional pg client for running in a transaction
 * @returns {Promise<boolean>} True if newly recorded (process it), false if duplicate (skip it)
 */
export const markEventProcessed = async (consumerGroup, eventId, eventType, client = pool) => {
  if (!consumerGroup || !eventId) {
    throw new Error('[ConsumerIdempotency] consumerGroup and eventId are required');
  }

  const query = `
    INSERT INTO processed_events (consumer_group, event_id, event_type)
    VALUES ($1, $2, $3)
    ON CONFLICT (consumer_group, event_id) DO NOTHING
    RETURNING 1;
  `;

  try {
    const result = await client.query(query, [consumerGroup, eventId, eventType || 'UNKNOWN']);
    return result.rowCount > 0;
  } catch (error) {
    console.error(`[ConsumerIdempotency] Database error checking idempotency for event ${eventId}:`, error.message);
    throw error;
  }
};


/**
 * Remove processed event records (primarily for testing and environment resets).
 *
 * @param {string} [consumerGroup]
 * @param {Object} [client=pool]
 * @returns {Promise<number>} Number of deleted records
 */
export const clearProcessedEvents = async (consumerGroup, client = pool) => {
  let query = 'DELETE FROM processed_events';
  const params = [];

  if (consumerGroup) {
    query += ' WHERE consumer_group = $1';
    params.push(consumerGroup);
  }

  const result = await client.query(query, params);
  return result.rowCount;
};
