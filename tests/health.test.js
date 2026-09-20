const request = require('supertest');
const RedisMock = require('ioredis-mock');
const app = require('../src/app');
const config = require('../src/config');
const { connectDB, disconnectDB } = require('../src/config/db');
const { _setClientForTest } = require('../src/config/redis');

describe('Scaffolding & Health Check (V0-T01, V0-T02, V1-T01)', () => {
  let redisMock;

  beforeEach(() => {
    redisMock = new RedisMock();
    _setClientForTest(redisMock, 'ready');
  });

  afterAll(async () => {
    _setClientForTest(null, 'disconnected');
    await disconnectDB();
  });

  it('should load environment configurations properly including Redis', () => {
    expect(config.port).toBeDefined();
    expect(config.nodeEnv).toBeDefined();
    expect(config.mongoUri).toBeDefined();
    expect(config.uploadDir).toBeDefined();
    expect(config.maxFileSize).toBeGreaterThan(0);
    expect(config.redisHost).toBeDefined();
    expect(config.redisPort).toBe(6379);
  });

  it('GET /health should return 503 and degraded status when DB is disconnected', async () => {
    await disconnectDB();
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('degraded');
    expect(res.body.db.status).toEqual('disconnected');
    expect(res.body.redis.status).toEqual('ready');
  });

  it('GET /health should return 503 and degraded status when Redis is disconnected', async () => {
    await connectDB(config.mongoUri);
    _setClientForTest(null, 'disconnected');

    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('degraded');
    expect(res.body.db.status).toEqual('connected');
    expect(res.body.redis.status).toEqual('disconnected');
  });

  it('GET /health should return 200 with ok status when both DB and Redis are connected', async () => {
    await connectDB(config.mongoUri);
    _setClientForTest(redisMock, 'ready');

    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
    expect(res.body.db.status).toEqual('connected');
    expect(res.body.redis.status).toEqual('ready');
  });
});
