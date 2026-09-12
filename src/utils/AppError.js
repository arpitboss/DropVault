/**
 * Custom operational error class for DropVault.
 * Encapsulates HTTP status codes, operational error flags, and optional context details.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error explanation
   * @param {number} [statusCode=500] - HTTP status code
   * @param {*} [details=null] - Optional structured metadata or validation errors
   * @param {boolean} [isOperational=true] - True for known operational errors
   */
  constructor(message, statusCode = 500, details = null, isOperational = true) {
    super(message);

    this.name = this.constructor.name;
    this.status = statusCode;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details = null) {
    return new AppError(message, 400, details, true);
  }

  static unauthorized(message = 'Unauthorized', details = null) {
    return new AppError(message, 401, details, true);
  }

  static forbidden(message = 'Forbidden', details = null) {
    return new AppError(message, 403, details, true);
  }

  static notFound(message = 'Resource not found', details = null) {
    return new AppError(message, 404, details, true);
  }

  static gone(message = 'Resource has expired or has been consumed', details = null) {
    return new AppError(message, 410, details, true);
  }

  static payloadTooLarge(message = 'Payload exceeds maximum limit', details = null) {
    return new AppError(message, 413, details, true);
  }

  static internal(message = 'Internal server error', details = null) {
    return new AppError(message, 500, details, false);
  }
}

module.exports = AppError;
