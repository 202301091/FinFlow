import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined, // Removes pid and hostname
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'token',
    'authorization',
    'refreshToken',
    'pin',
    'transactionPin',
    'transaction_pin',
    'transaction_pin_hash',
    'pinHash',
  ],
});

/**
 * HTTP Request Logger Middleware
 * Logs strictly the required fields:
 * - Timestamp
 * - Log level (info, warn, error)
 * - Request ID
 * - HTTP method and route
 * - Response status code
 * - Request duration
 * - Error message, when applicable
 */
export const httpLogger = (req, res, next) => {
  // Skip /metrics to avoid polluting application logs with scraper requests
  if (req.path === '/metrics') {
    return next();
  }

  const startTime = process.hrtime();
  req.log = logger;

  let finalized = false;

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    const diff = process.hrtime(startTime);
    const durationMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);

    let rawRoute = req.route?.path;
    if (Array.isArray(rawRoute)) {
      rawRoute = rawRoute.find((p) => req.path.endsWith(p)) || rawRoute[0];
    } else if (typeof rawRoute === 'string' && rawRoute.includes(',')) {
      const parts = rawRoute.split(',');
      rawRoute = parts.find((p) => req.path.endsWith(p)) || parts[0];
    }

    let route;
    if (req.route && rawRoute) {
      route = (req.baseUrl || '') + rawRoute;
      // Normalize IDs to prevent high cardinality
      route = route
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d+/g, '/:id');
    } else if (res.statusCode === 404) {
      route = 'not_found';
    } else {
      route = req.baseUrl ? `${req.baseUrl}/unmatched` : 'unmatched';
    }

    const statusCode = res.statusCode || (res.writableEnded ? 200 : 499);
    const requestId = req.id || req.requestId || req.headers['x-request-id'] || 'N/A';
    const errorMessage = res.locals?.errorMessage || res.locals?.error || null;

    const logEntry = {
      requestId,
      method: req.method,
      route,
      statusCode,
      duration: `${durationMs}ms`,
    };

    if (errorMessage || statusCode >= 400) {
      logEntry.error = errorMessage || res.statusMessage || `HTTP ${statusCode}`;
    }

    if (statusCode >= 500) {
      logger.error(logEntry);
    } else if (statusCode >= 400) {
      logger.warn(logEntry);
    } else {
      logger.info(logEntry);
    }
  };

  res.on('finish', finalize);
  res.on('close', finalize);

  next();
};

export { logger, logger as looger };
export default logger;