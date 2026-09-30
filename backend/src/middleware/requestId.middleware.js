import crypto from 'crypto';

/**
 * Middleware to generate or preserve X-Request-ID.
 * - If client/proxy provides X-Request-ID, preserve it.
 * - Otherwise, generate a unique UUID v4.
 * - Attaches to req.id and req.requestId for application use.
 * - Sets the X-Request-ID header on outgoing HTTP responses.
 */
export const requestIdMiddleware = (req, res, next) => {
  const incomingId =
    req.header('x-request-id') ||
    req.header('X-Request-ID') ||
    req.headers['x-request-id'];

  const requestId =
    incomingId && typeof incomingId === 'string' && incomingId.trim()
      ? incomingId.trim()
      : crypto.randomUUID();

  req.id = requestId;
  req.requestId = requestId;

  res.setHeader('X-Request-ID', requestId);
  next();
};

export default requestIdMiddleware;
