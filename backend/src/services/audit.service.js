import { pool } from '../config/db.js';

// Keys that must NEVER be stored in audit logs
const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'jwt',
  'cookie',
  'cookies',
]);

/**
 * Recursively sanitize metadata to remove sensitive credentials and tokens
 */
export const sanitizeAuditMetadata = (data) => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditMetadata(item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      clean[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      clean[key] = sanitizeAuditMetadata(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
};

/**
 * Insert an immutable audit log record for important actions.
 *
 * @param {Object} params
 * @param {string} [params.userId] - Authenticated user ID
 * @param {string} params.action - Action name (e.g. 'TRANSFER_COMPLETED', 'TRANSFER_FAILED')
 * @param {string} params.resourceType - Target resource category ('transaction', 'account')
 * @param {string} [params.resourceId] - UUID of the target resource
 * @param {string} [params.requestId] - Correlation X-Request-ID
 * @param {string} params.status - 'SUCCESS' or 'FAILURE'
 * @param {Object} [params.metadata] - Action-specific context without sensitive info
 * @param {Object} [params.client] - Optional pg client for transactional consistency
 * @returns {Promise<Object>} The persisted audit record
 */
export const createAuditLog = async ({
  userId = null,
  action,
  resourceType,
  resourceId = null,
  requestId = null,
  status = 'SUCCESS',
  metadata = {},
  client = null,
}) => {
  try {
    const sanitized = sanitizeAuditMetadata(metadata);
    const db = client || pool;

    const result = await db.query(
      `INSERT INTO audit_logs (
         user_id,
         action,
         resource_type,
         resource_id,
         request_id,
         status,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId || null,
        action,
        resourceType,
        resourceId || null,
        requestId || null,
        status,
        JSON.stringify(sanitized),
      ]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Failed to create audit log:', error.message);
    throw error;
  }
};
