/**
 * Custom Error class for standardizing API error responses.
 * Extends the native Error class.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status code (e.g. 400, 401, 404, 500)
   * @param {string} [message="Something went wrong"] - Human-readable error message
   * @param {Array|any} [errors=[]] - Array of specific error details or validation errors
   * @param {string} [stack=""] - Optional custom stack trace
   */
  constructor(
    statusCode,
    message = "Something went wrong",
    errors = [],
    stack = ""
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = Array.isArray(errors) ? errors : [errors].filter(Boolean);
    this.error = this.errors; // Alias for backward compatibility

    // Make message explicitly enumerable for JSON serialization
    Object.defineProperty(this, "message", {
      value: message,
      enumerable: true,
      writable: true,
      configurable: true,
    });

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Ensure JSON serialization includes all relevant fields cleanly.
   */
  toJSON() {
    return {
      statusCode: this.statusCode,
      data: this.data,
      message: this.message,
      success: this.success,
      errors: this.errors,
      ...(process.env.NODE_ENV === "development" ? { stack: this.stack } : {}),
    };
  }

  // Convenient static factory methods
  static badRequest(message = "Bad Request", errors = []) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = "Unauthorized", errors = []) {
    return new ApiError(401, message, errors);
  }

  static forbidden(message = "Forbidden", errors = []) {
    return new ApiError(403, message, errors);
  }

  static notFound(message = "Resource not found", errors = []) {
    return new ApiError(404, message, errors);
  }

  static conflict(message = "Conflict", errors = []) {
    return new ApiError(409, message, errors);
  }

  static internal(message = "Internal server error", errors = []) {
    return new ApiError(500, message, errors);
  }
}

export { ApiError };
export default ApiError;