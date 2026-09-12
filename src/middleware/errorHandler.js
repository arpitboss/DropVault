const multer = require('multer');
const config = require('../config');
const { logger } = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * 404 Route Not Found Handler.
 * Invoked when no preceding route or static asset matches the request.
 */
const notFoundHandler = (req, res, next) => {
  next(AppError.notFound(`Cannot ${req.method} ${req.originalUrl}`));
};

/**
 * Centralized error-handling middleware for DropVault (V0-T13).
 * Intercepts all operational, library, and unhandled errors.
 * Ensures consistent error formatting, LOG-1 structured logging, and prevents
 * internal stack trace leaks in production.
 */
const errorHandler = (err, req, res, next) => {
  const requestId = req.id || req.headers['x-request-id'] || 'unknown';

  let statusCode = err.status || err.statusCode || 500;
  let errorMessage = err.message || 'Internal server error';
  let errorDetails = err.details || null;

  // 1. Multer Errors (File size limit, etc.)
  if (err instanceof multer.MulterError || err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      statusCode = 413;
      errorMessage = `File size exceeds the limit of ${config.maxFileSize} bytes`;
    } else {
      statusCode = 400;
      errorMessage = err.message;
    }
  }

  // 2. Body Parser Payload Too Large Errors
  if (err.type === 'entity.too.large' || err.status === 413) {
    statusCode = 413;
    errorMessage = `Text content exceeds maximum limit of ${config.maxTextSize} bytes`;
  }

  // 3. Mongoose Validation Errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorMessage = err.message;
  }

  // 4. Mongoose CastError (invalid ObjectId, etc.)
  if (err.name === 'CastError') {
    statusCode = 400;
    errorMessage = `Invalid format for field: ${err.path}`;
  }

  // 5. In production, never expose internal error details or stack traces for 500s (LOG-2)
  const isProduction = process.env.NODE_ENV === 'production' || config.nodeEnv === 'production';
  if (statusCode >= 500 && isProduction) {
    errorMessage = 'Internal server error';
    errorDetails = null;
  }

  // Log error using structured logger
  const logPayload = {
    requestId,
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode,
    message: err.message,
    ...(statusCode >= 500 ? { stack: err.stack } : {}),
  };

  if (statusCode >= 500) {
    logger.error(`Server Error: ${err.message}`, logPayload);
  } else {
    logger.warn(`Operational Error: ${err.message}`, logPayload);
  }

  // Consistent response structure
  const responseBody = {
    error: errorMessage,
    requestId,
  };

  if (errorDetails) {
    responseBody.details = errorDetails;
  }

  return res.status(statusCode).json(responseBody);
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
