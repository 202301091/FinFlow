import { pool } from '../config/db.js';
import logger from '../config/logger.js';

export const executeWithRetry = async (
  operation,
  { maxRetries = 3, baseDelayMs = 100 } = {}
) => {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};

export const recordDeadLetter = async (
  { consumerGroup, topic, event, error, retryCount = 0 },
  client = pool
) => {
  const eventId = event?.eventId || null;
  const eventType = event?.eventType || 'UNKNOWN';
  const payload = event || {};
  const errorMessage = error?.message || String(error);
  const stackTrace = error?.stack || null;

  logger.error(
    { err: error, eventId, consumerGroup, topic, retryCount },
    `[Consumer DLQ] Offloading failed event ${eventId} (group: ${consumerGroup}, topic: ${topic}): ${errorMessage}`
  );

  const query = `
    INSERT INTO consumer_dlq (consumer_group, topic, event_id, event_type, payload, error_message, stack_trace, retry_count)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, created_at;
  `;

  try {
    const result = await client.query(query, [
      consumerGroup,
      topic,
      eventId,
      eventType,
      JSON.stringify(payload),
      errorMessage,
      stackTrace,
      retryCount,
    ]);
    return result.rows[0];
  } catch (dbErr) {
    logger.error({ err: dbErr }, `[Consumer DLQ] Fatal DB error writing to consumer_dlq: ${dbErr.message}`);
    return null;
  }
};
