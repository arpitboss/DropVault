const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const { connectDB, disconnectDB } = require('../src/config/db');

describe('Scaffolding & Health Check', () => {
  afterAll(async () => {
    await disconnectDB();
  });

  it('should load environment configurations properly', () => {
    expect(config.port).toBeDefined();
    expect(config.nodeEnv).toBeDefined();
    expect(config.mongoUri).toBeDefined();
    expect(config.uploadDir).toBeDefined();
    expect(config.maxFileSize).toBeGreaterThan(0);
  });

  it('GET /health should return 503 and degraded status when DB is disconnected', async () => {
    await disconnectDB();
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('degraded');
    expect(res.body.db.status).toEqual('disconnected');
  });

  it('GET /health should return 200 with DB status connected when DB is connected', async () => {
    await connectDB(config.mongoUri);
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
    expect(res.body.db.status).toEqual('connected');
  });
});
