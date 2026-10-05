const { getRedisClient, isRedisConnected } = require('../config/redis');
const config = require('../config');
const { logger } = require('../utils/logger');
const { normalizeIp } = require('../utils/ipValidator');

/**
 * Lua script for atomic fixed-window rate limiting (V1-T13).
 *
 * KEYS[1]: Rate limit key (`ratelimit:<tier>:<ip>`)
 * ARGV[1]: Window duration in seconds
 *
 * Returns array: [ currentCount, remainingTtlSeconds ]
 */
const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { current, ttl }
`;

/**
 * Extracts client IP from request headers or socket.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return normalizeIp(forwarded.split(',')[0]);
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || '127.0.0.1');
};

/**
 * Factory creating Redis-backed rate limiting middleware for a given tier.
 *
 * @param {Object} options
 * @param {string} [options.tierName='general'] - Identifier for key namespace
 * @param {number} [options.max=60] - Maximum requests permitted in window
 * @param {number} [options.windowSeconds=60] - Window duration in seconds
 * @returns {import('express').RequestHandler}
 */
const createRateLimiter = ({
  tierName = 'general',
  max = 60,
  windowSeconds = 60,
} = {}) => {
  return async (req, res, next) => {
    // Bypass if rate limiting is globally disabled
    if (config.rateLimit && config.rateLimit.enabled === false) {
      return next();
    }

    // Fail open if Redis is not currently ready/connected
    if (!isRedisConnected()) {
      return next();
    }

    const client = getRedisClient();
    if (!client) {
      return next();
    }

    try {
      const clientIp = getClientIp(req);
      const key = `ratelimit:${tierName}:${clientIp}`;

      const [current, ttl] = await client.eval(
        RATE_LIMIT_LUA,
        1,
        key,
        windowSeconds
      );

      const count = Number(current);
      const retryAfter = Math.max(1, Number(ttl));
      const remaining = Math.max(0, max - count);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', retryAfter);

      if (count > max) {
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          status: 'error',
          statusCode: 429,
          error: 'Too many requests, please try again later',
          retryAfter,
        });
      }

      return next();
    } catch (err) {
      logger.warn(`[DropVault] Rate limiter error: ${err.message}. Failing open.`);
      return next();
    }
  };
};

const strictRateLimiter = createRateLimiter({
  tierName: 'strict',
  max: config.rateLimit?.strictLimit || 5,
  windowSeconds: config.rateLimit?.strictWindow || 60,
});

const uploadRateLimiter = createRateLimiter({
  tierName: 'upload',
  max: config.rateLimit?.uploadLimit || 20,
  windowSeconds: config.rateLimit?.uploadWindow || 60,
});

const shareRateLimiter = createRateLimiter({
  tierName: 'share',
  max: config.rateLimit?.shareLimit || 60,
  windowSeconds: config.rateLimit?.shareWindow || 60,
});

const globalRateLimiter = createRateLimiter({
  tierName: 'global',
  max: config.rateLimit?.globalLimit || 120,
  windowSeconds: config.rateLimit?.globalWindow || 60,
});

module.exports = {
  createRateLimiter,
  strictRateLimiter,
  uploadRateLimiter,
  shareRateLimiter,
  globalRateLimiter,
  getClientIp,
};
