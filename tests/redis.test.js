const RedisMock = require('ioredis-mock');
const config = require('../src/config');
const {
  connectRedis,
  disconnectRedis,
  isRedisConnected,
  getRedisStatus,
  getRedisClient,
  calculateRetryDelay,
  _setClientForTest,
} = require('../src/config/redis');

describe('Redis Configuration & Connection Manager (V1-T01)', () => {
  let redisMock;

  beforeEach(() => {
    redisMock = new RedisMock();
  });

  afterEach(async () => {
    _setClientForTest(null, 'disconnected');
  });

  it('should read Redis connection parameters from config', () => {
    expect(config.redisHost).toBeDefined();
    expect(config.redisPort).toBe(6379);
    expect(typeof config.redisHost).toBe('string');
    expect(typeof config.redisPort).toBe('number');
  });

  it('should initially report disconnected when no client is connected', () => {
    expect(isRedisConnected()).toBe(false);
    expect(getRedisStatus()).toBe('disconnected');
    expect(getRedisClient()).toBeNull();
  });

  it('should connect using mock client and report ready status', async () => {
    const client = await connectRedis(redisMock);

    expect(client).toBeDefined();
    expect(isRedisConnected()).toBe(true);
    expect(getRedisStatus()).toBe('ready');
    expect(getRedisClient()).toBe(redisMock);
  });

  it('should perform basic Redis key-value and atomic operations successfully', async () => {
    const client = await connectRedis(redisMock);

    // Test string set and get
    await client.set('dropvault:test:key', 'secret_value');
    const val = await client.get('dropvault:test:key');
    expect(val).toBe('secret_value');

    // Test atomic counter increment (used for rate limiting and download counters)
    await client.incr('dropvault:test:counter');
    await client.incr('dropvault:test:counter');
    const count = await client.get('dropvault:test:counter');
    expect(count).toBe('2');

    // Test expiration
    await client.expire('dropvault:test:key', 60);
    const ttl = await client.ttl('dropvault:test:key');
    expect(ttl).toBeGreaterThan(0);

    // Test key deletion
    await client.del('dropvault:test:key');
    const deletedVal = await client.get('dropvault:test:key');
    expect(deletedVal).toBeNull();
  });

  it('should gracefully disconnect and update status to disconnected', async () => {
    await connectRedis(redisMock);
    expect(isRedisConnected()).toBe(true);

    await disconnectRedis();
    expect(isRedisConnected()).toBe(false);
    expect(getRedisStatus()).toBe('disconnected');
    expect(getRedisClient()).toBeNull();
  });

  it('should safely handle disconnect when already disconnected', async () => {
    expect(getRedisStatus()).toBe('disconnected');
    await expect(disconnectRedis()).resolves.toBeUndefined();
    expect(getRedisStatus()).toBe('disconnected');
  });

  it('calculateRetryDelay should implement backoff and cap retries in test environment', () => {
    // In test environment, returns delay for first 2 attempts, then null to prevent hanging
    expect(calculateRetryDelay(1)).toBe(150);
    expect(calculateRetryDelay(2)).toBe(300);
    expect(calculateRetryDelay(3)).toBeNull();
  });
});
