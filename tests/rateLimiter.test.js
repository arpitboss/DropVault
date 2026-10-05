const express = require('express');
const request = require('supertest');
const RedisMock = require('ioredis-mock');
const {
  connectRedis,
  disconnectRedis,
  _setClientForTest,
} = require('../src/config/redis');
const {
  createRateLimiter,
  strictRateLimiter,
  uploadRateLimiter,
  shareRateLimiter,
} = require('../src/middleware/rateLimiter');

describe('Redis Rate Limiting Middleware (V1-T13)', () => {
  let redisMock;
  let testApp;

  beforeEach(async () => {
    redisMock = new RedisMock();
    await redisMock.flushall();
    await connectRedis(redisMock);

    testApp = express();
    testApp.use(express.json());

    // Test route with limit = 3 requests per 60 seconds
    const customLimiter = createRateLimiter({
      tierName: 'test-tier',
      max: 3,
      windowSeconds: 60,
    });

    testApp.get('/test/limited', customLimiter, (req, res) => {
      res.status(200).json({ success: true, message: 'ok' });
    });

    testApp.get('/test/strict', strictRateLimiter, (req, res) => {
      res.status(200).json({ success: true, message: 'strict ok' });
    });
  });

  afterEach(async () => {
    if (redisMock) {
      await redisMock.flushall();
    }
    await disconnectRedis();
    _setClientForTest(null, 'disconnected');
  });

  describe('Standard Limiting & Header Compliance', () => {
    it('should allow requests within limit and populate X-RateLimit headers', async () => {
      // 1st request -> remaining = 2
      const res1 = await request(testApp)
        .get('/test/limited')
        .expect(200);

      expect(res1.headers['x-ratelimit-limit']).toBe('3');
      expect(res1.headers['x-ratelimit-remaining']).toBe('2');
      expect(Number(res1.headers['x-ratelimit-reset'])).toBeGreaterThan(0);

      // 2nd request -> remaining = 1
      const res2 = await request(testApp)
        .get('/test/limited')
        .expect(200);

      expect(res2.headers['x-ratelimit-remaining']).toBe('1');

      // 3rd request -> remaining = 0
      const res3 = await request(testApp)
        .get('/test/limited')
        .expect(200);

      expect(res3.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('should block 4th request with 429 Too Many Requests and Retry-After header', async () => {
      // Consume first 3 requests
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(200);

      // 4th request exceeds limit
      const blockedRes = await request(testApp)
        .get('/test/limited')
        .expect(429);

      expect(blockedRes.body).toHaveProperty('statusCode', 429);
      expect(blockedRes.body).toHaveProperty(
        'error',
        'Too many requests, please try again later'
      );
      expect(blockedRes.body).toHaveProperty('retryAfter');
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
    });
  });

  describe('IP Isolation', () => {
    it('should isolate rate limits across different client IP addresses', async () => {
      // Exhaust limit for Client A (198.51.100.1)
      await request(testApp).get('/test/limited').set('X-Forwarded-For', '198.51.100.1').expect(200);
      await request(testApp).get('/test/limited').set('X-Forwarded-For', '198.51.100.1').expect(200);
      await request(testApp).get('/test/limited').set('X-Forwarded-For', '198.51.100.1').expect(200);
      await request(testApp).get('/test/limited').set('X-Forwarded-For', '198.51.100.1').expect(429);

      // Client B (203.0.113.2) should NOT be blocked
      const clientBRes = await request(testApp)
        .get('/test/limited')
        .set('X-Forwarded-For', '203.0.113.2')
        .expect(200);

      expect(clientBRes.headers['x-ratelimit-remaining']).toBe('2');
    });
  });

  describe('Tier Isolation', () => {
    it('should maintain independent counters across different tiers', async () => {
      // Exhaust custom test tier
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(429);

      // Strict tier route should have its own separate limit
      const strictRes = await request(testApp)
        .get('/test/strict')
        .expect(200);

      expect(strictRes.body.message).toBe('strict ok');
    });
  });

  describe('Fail-Open Security for Rate Limiting', () => {
    it('should fail open and allow requests when Redis is unavailable', async () => {
      // Simulate Redis disconnect
      _setClientForTest(null, 'disconnected');

      // Request should pass through rather than returning 500/503
      const res = await request(testApp)
        .get('/test/limited')
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('Window Expiration / Reset', () => {
    it('should reset limit after window expires (clearing key)', async () => {
      // Exhaust limit
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(200);
      await request(testApp).get('/test/limited').expect(429);

      // Clear the Redis key to simulate window expiration
      await redisMock.flushall();

      // Should succeed again
      const res = await request(testApp)
        .get('/test/limited')
        .expect(200);

      expect(res.headers['x-ratelimit-remaining']).toBe('2');
    });
  });
});
