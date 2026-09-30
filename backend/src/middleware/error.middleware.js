import { ApiError } from '../utils/ApiError.js';

/**
 * PostgreSQL Error Code Map:
 * Translates PostgreSQL SQLSTATE error codes into sanitized ApiErrors.
 */
const handlePostgreSQLError = (err) => {
  switch (err.code) {
    case '23505': // unique_violation
      return new ApiError(409, 'A resource with these unique attributes already exists');
    case '23503': // foreign_key_violation
      return new ApiError(400, 'Referenced resource does not exist');
    case '22P02': // invalid_text_representation (e.g. invalid UUID format)
      return new ApiError(400, 'Invalid data or identifier format provided');
    case '23514': // check_violation
      return new ApiError(400, 'Operation violates a system data constraint');
    case '40P01': // deadlock_detected
      return new ApiError(503, 'Transaction concurrency conflict. Please retry your request');
    case '55P03': // lock_not_available
      return new ApiError(503, 'Resource currently locked by another process. Please retry');
    case '57014': // query_canceled / timeout
      return new ApiError(504, 'Database query timed out');
    default:
      return null;
  }
};

/**
 * Centralized global error handling middleware.
 * Ensures consistent response format and shields clients from internal database details.
 */
export const errorHandler = (err, req, res, next) => {
  // 1. Direct ApiError instances
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err);
  }

  // 2. Body Parser / JSON Syntax Error
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    const apiError = new ApiError(400, 'Malformed JSON in request body');
    return res.status(apiError.statusCode).json(apiError);
  }

  // 3. PostgreSQL Database Errors
  if (err?.code && typeof err.code === 'string') {
    const pgError = handlePostgreSQLError(err);
    if (pgError) {
      return res.status(pgError.statusCode).json(pgError);
    }
  }

  // 4. JWT Verification Errors
  if (err?.name === 'JsonWebTokenError') {
    const apiError = new ApiError(401, 'Invalid authentication token');
    return res.status(apiError.statusCode).json(apiError);
  }

  if (err?.name === 'TokenExpiredError') {
    const apiError = new ApiError(401, 'Authentication token has expired');
    return res.status(apiError.statusCode).json(apiError);
  }

  // 5. Unhandled / Unexpected Server Errors
  // Log privately on server for developer inspection
  console.error(`[Server Error] [Request ID: ${req.id || 'N/A'}]:`, err.stack || err);

  // Return sanitized 500 error to client without exposing database queries or stack traces
  const internalError = new ApiError(
    500,
    process.env.NODE_ENV === 'test' && err.message
      ? err.message
      : 'An unexpected internal server error occurred'
  );

  return res.status(500).json(internalError);
};

export default errorHandler;
