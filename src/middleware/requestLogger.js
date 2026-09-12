const crypto = require('crypto');
const { logger } = require('../utils/logger');

/**
 * Sanitizes URL paths to prevent leaking full bearer/share tokens in request logs (LOG-2).
 * e.g., /s/p47Q0t5w1f7Y8z9A... becomes /s/p47Q0t...
 */
const sanitizeUrl = (originalUrl) => {
  if (typeof originalUrl !== 'string') return originalUrl;

  // Mask /s/:shortCode share URLs
  return originalUrl.replace(/\/s\/([A-Za-z0-9_-]{10,})/g, (match, token) => {
    return `/s/${token.slice(0, 6)}...[REDACTED]`;
  });
};

/**
 * Request logger middleware.
 * Assigns a unique Request ID, attaches X-Request-Id header, and logs structured request metrics (LOG-1, LOG-2).
 */
const requestLogger = (req, res, next) => {
  // Assign correlation ID (honor incoming header or generate cryptographically secure UUID)
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startTime = process.hrtime.bigint();

  // Log on response completion
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number((endTime - startTime) / 1000000n);

    const sanitizedUrl = sanitizeUrl(req.originalUrl || req.url);

    const logMeta = {
      requestId,
      method: req.method,
      url: sanitizedUrl,
      status: res.statusCode,
      durationMs,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    const message = `${req.method} ${sanitizedUrl} ${res.statusCode} in ${durationMs}ms`;

    if (res.statusCode >= 500) {
      logger.error(message, logMeta);
    } else if (res.statusCode >= 400) {
      logger.warn(message, logMeta);
    } else {
      logger.info(message, logMeta);
    }
  });

  next();
};

module.exports = {
  requestLogger,
  sanitizeUrl,
};
