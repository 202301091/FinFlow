/**
 * Standardized API response format for successful operations.
 */
class ApiResponse {
  /**
   * @param {number} statusCode - HTTP status code (e.g. 200, 201)
   * @param {any} [data=null] - Payload to return to the client
   * @param {string} [message="Success"] - Response message
   */
  constructor(statusCode, data = null, message = "Success") {
    this.statusCode = statusCode;
    this.statuscode = statusCode; // Alias for backward compatibility
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
  }

  /**
   * Ensure clean JSON serialization.
   */
  toJSON() {
    return {
      statusCode: this.statusCode,
      data: this.data,
      message: this.message,
      success: this.success,
    };
  }

  // Convenient static factory methods
  static ok(data = null, message = "Success") {
    return new ApiResponse(200, data, message);
  }

  static created(data = null, message = "Resource created successfully") {
    return new ApiResponse(201, data, message);
  }
}

export { ApiResponse };
export default ApiResponse;