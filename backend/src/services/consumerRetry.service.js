import { pool } from '../config/db.js';

/**
 * Execute an asynchronous operation with exponential backoff retries.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} operation - Asynchronous task
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3] - Maximum retry attempts before giving up
 * @param {number} [options.baseDelayMs=100] - Base delay for exponential backoff
 * @returns {Promise<T>}
 */
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

/**
 * Persist an unprocessable or repeatedly failing message into the consumer_dlq table.
 *
 * @param {Object} params
 * @param {string} params.consumerGroup - Group identifier (e.g. 'finflow-notifications-group')
 * @param {string} params.topic - Kafka topic
 * @param {any} params.event - Deserialized or raw event payload
 * @param {Error|string} params.error - Caught exception
 * @param {number} [params.retryCount=0] - Number of retries attempted
 * @param {Object} [client=pool]
 * @returns {Promise<Object|null>} Saved DLQ record
 */
export const recordDeadLetter = async (
  { consumerGroup, topic, event, error, retryCount = 0 },
  client = pool
) => {
  const eventId = event?.eventId || null;
  const eventType = event?.eventType || 'UNKNOWN';
  const payload = event || {};
  const errorMessage = error?.message || String(error);
  const stackTrace = error?.stack || null;

  console.error(
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
    console.error('[Consumer DLQ] Fatal DB error writing to consumer_dlq:', dbErr.message);
    return null;
  }
};
