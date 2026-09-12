const config = require('../config');

// Log level hierarchy
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Sensitive field names that must never be exposed (LOG-2)
const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'shortcode',
  'authorization',
  'cookie',
  'key',
  'kek',
  'dek',
  'authtag',
  'iv',
  'buffer',
  'content',
]);

/**
 * Sanitizes MongoDB connection URIs by redacting credentials (LOG-2).
 */
const sanitizeUri = (uri) => {
  if (typeof uri !== 'string') return uri;
  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/i, '$1$2:***@');
};

/**
 * Sanitizes tokens or long secret strings by truncating and masking (LOG-2).
 */
const maskToken = (str) => {
  if (typeof str !== 'string') return str;
  if (str.length >= 32) {
    return `${str.slice(0, 6)}...[REDACTED]`;
  }
  return '[REDACTED]';
};

/**
 * Recursively deep-sanitizes objects or arrays to prevent leaking sensitive keys (LOG-2).
 */
const sanitizeData = (data) => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = typeof value === 'string' ? maskToken(value) : '[REDACTED]';
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeUri(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
};

/**
 * Determine the active log level from environment.
 */
const getActiveLogLevel = () => {
  if (process.env.LOG_LEVEL && LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()] !== undefined) {
    return LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()];
  }
  if (config.nodeEnv === 'test' && !process.env.LOG_TEST) {
    return LOG_LEVELS.error; // Only errors during test runs by default
  }
  if (config.nodeEnv === 'production') {
    return LOG_LEVELS.info;
  }
  return LOG_LEVELS.debug;
};

/**
 * Format a structured log entry (LOG-1, LOG-2).
 */
const formatEntry = (level, message, meta = {}) => {
  const cleanMeta = sanitizeData(meta);

  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(cleanMeta && Object.keys(cleanMeta).length > 0 ? { meta: cleanMeta } : {}),
  };
};

/**
 * Structured logger implementation.
 */
class Logger {
  constructor() {
    this.levels = LOG_LEVELS;
  }

  log(level, message, meta = {}) {
    const activeLevel = getActiveLogLevel();
    const currentLevelNum = this.levels[level] !== undefined ? this.levels[level] : this.levels.info;

    if (currentLevelNum < activeLevel) {
      return null;
    }

    const entry = formatEntry(level, message, meta);
    const jsonString = JSON.stringify(entry);

    if (level === 'error') {
      console.error(jsonString);
    } else if (level === 'warn') {
      console.warn(jsonString);
    } else {
      console.log(jsonString);
    }

    return entry;
  }

  debug(message, meta) {
    return this.log('debug', message, meta);
  }

  info(message, meta) {
    return this.log('info', message, meta);
  }

  warn(message, meta) {
    return this.log('warn', message, meta);
  }

  error(message, meta) {
    return this.log('error', message, meta);
  }
}

const logger = new Logger();

module.exports = {
  logger,
  Logger,
  LOG_LEVELS,
  sanitizeData,
  sanitizeUri,
  maskToken,
  formatEntry,
};
