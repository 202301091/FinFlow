import { pool } from '../config/db.js';
import logger from '../config/logger.js';

// Atomically record event processing; returns true if new, false if duplicate
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
    logger.error({ err: error, eventId }, `[ConsumerIdempotency] Database error checking idempotency for event ${eventId}: ${error.message}`);
    throw error;
  }
};


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
