import crypto from 'crypto';
import { pool } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Deterministically compute a SHA-256 hash of the request parameters.
 * Keys are sorted so property order does not affect the resulting hash.
 */
export const computeRequestHash = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return crypto.createHash('sha256').update(String(payload || '')).digest('hex');
  }
  const sortedKeys = Object.keys(payload).sort();
  const sortedObj = {};
  for (const k of sortedKeys) {
    if (payload[k] !== undefined) {
      sortedObj[k] = payload[k];
    }
  }
  return crypto.createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex');
};

/**
 * Verify or initialize an idempotency key.
 *
 * @param {Object} params
 * @param {string} params.key - The idempotency key from header
 * @param {string} params.userId - Authenticated user ID
 * @param {string} params.requestPath - e.g. '/api/v1/transactions/transfer'
 * @param {string} params.requestHash - SHA-256 of request payload
 * @returns {Promise<{ isReplay: boolean, responseStatus?: number, responseBody?: any }>}
 */
export const checkOrCreateIdempotencyKey = async ({ key, userId, requestPath, requestHash }) => {
  // Attempt atomic insert with 'in_progress' status
  const insertResult = await pool.query(
    `INSERT INTO idempotency_keys (key, user_id, request_path, request_hash, status)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (user_id, key) DO NOTHING
     RETURNING *`,
    [key, userId, requestPath, requestHash]
  );

  if (insertResult.rows.length > 0) {
    // Successfully acquired key, proceed with execution
    return { isReplay: false };
  }

  // Row already exists - check state
  const existingResult = await pool.query(
    `SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );

  if (existingResult.rows.length === 0) {
    return { isReplay: false };
  }

  const existing = existingResult.rows[0];

  // 1. Verify payload match
  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      400,
      'Idempotency key reuse: request payload does not match the original request for this key'
    );
  }

  // 2. If completed, return cached response
  if (existing.status === 'completed') {
    return {
      isReplay: true,
      responseStatus: existing.response_status || 200,
      responseBody: existing.response_body,
    };
  }

  // 3. If in progress, reject concurrent duplicate request
  if (existing.status === 'in_progress') {
    throw new ApiError(
      409,
      'A request with this idempotency key is currently being processed. Please wait.'
    );
  }

  // 4. If failed, allow retry by updating status back to 'in_progress'
  if (existing.status === 'failed') {
    await pool.query(
      `UPDATE idempotency_keys 
       SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND key = $2`,
      [userId, key]
    );
    return { isReplay: false };
  }

  return { isReplay: false };
};

/**
 * Mark idempotency record as completed with response payload
 */
export const markIdempotencyCompleted = async ({ key, userId, statusCode, responseBody }) => {
  await pool.query(
    `UPDATE idempotency_keys
     SET status = 'completed',
         response_status = $1,
         response_body = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $3 AND key = $4`,
    [statusCode, responseBody, userId, key]
  );
};

/**
 * Mark idempotency record as failed to allow clean retry
 */
export const markIdempotencyFailed = async ({ key, userId }) => {
  await pool.query(
    `UPDATE idempotency_keys
     SET status = 'failed',
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND key = $2`,
    [userId, key]
  );
};
