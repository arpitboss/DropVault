const RedisMock = require('ioredis-mock');
const {
  connectRedis,
  disconnectRedis,
  _setClientForTest,
} = require('../src/config/redis');
const redisAccessService = require('../src/services/redisAccessService');
const {
  initShareState,
  consumeOneTime,
  incrementDownload,
  getShareState,
  revokeShareState,
  getActiveKey,
  getDownloadsKey,
} = redisAccessService;

describe('Redis Access State Management Service (V1-T09)', () => {
  let redisMock;

  beforeEach(async () => {
    redisMock = new RedisMock();
    await connectRedis(redisMock);
  });

  afterEach(async () => {
    await disconnectRedis();
    _setClientForTest(null, 'disconnected');
  });

  describe('initShareState', () => {
    it('should initialize active key with correct prefix and value for one-time share', async () => {
      const shareId = 'mock-share-id-001';
      const result = await initShareState({
        shareId,
        oneTime: true,
      });

      expect(result.initialized).toBe(true);
      expect(result.keys).toContain(getActiveKey(shareId));

      const val = await redisMock.get(getActiveKey(shareId));
      expect(val).toBe('1');
    });

    it('should initialize downloads key to 0 for maxDownloads share', async () => {
      const shareId = 'mock-share-id-002';
      const result = await initShareState({
        shareId,
        maxDownloads: 5,
      });

      expect(result.initialized).toBe(true);
      expect(result.keys).toContain(getDownloadsKey(shareId));

      const val = await redisMock.get(getDownloadsKey(shareId));
      expect(val).toBe('0');
    });

    it('should set TTL on initialized keys matching expiresAt date (RED-4)', async () => {
      const shareId = 'mock-share-id-003';
      const expiresInSeconds = 300; // 5 minutes
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

      const result = await initShareState({
        shareId,
        oneTime: true,
        maxDownloads: 3,
        expiresAt,
      });

      expect(result.keys).toHaveLength(2);

      const activeTtl = await redisMock.ttl(getActiveKey(shareId));
      const downloadsTtl = await redisMock.ttl(getDownloadsKey(shareId));

      // Check TTL is approximately 300 seconds (+/- 5s margin)
      expect(activeTtl).toBeGreaterThan(290);
      expect(activeTtl).toBeLessThanOrEqual(300);
      expect(downloadsTtl).toBeGreaterThan(290);
      expect(downloadsTtl).toBeLessThanOrEqual(300);
    });

    it('should throw 400 when shareId is missing or empty', async () => {
      await expect(initShareState({})).rejects.toThrow(/shareId is required/i);
      await expect(initShareState({ shareId: '' })).rejects.toThrow(/shareId is required/i);
    });
  });

  describe('consumeOneTime (Atomic GETDEL - CON-1, RED-1)', () => {
    it('should return true on first consumption and false on second call', async () => {
      const shareId = 'mock-share-onetime-001';
      await initShareState({ shareId, oneTime: true });

      // First consumption -> winner!
      const firstResult = await consumeOneTime(shareId);
      expect(firstResult).toBe(true);

      // Second consumption -> already consumed!
      const secondResult = await consumeOneTime(shareId);
      expect(secondResult).toBe(false);

      // Key should now be deleted from Redis
      const val = await redisMock.get(getActiveKey(shareId));
      expect(val).toBeNull();
    });

    it('should return false if one-time key was never initialized or does not exist', async () => {
      const result = await consumeOneTime('non-existent-share-id');
      expect(result).toBe(false);
    });
  });

  describe('incrementDownload (Atomic Lua Script - CON-2, RED-2)', () => {
    it('should increment download count from 0 to 1, and return allowed=true', async () => {
      const shareId = 'mock-share-downloads-001';
      await initShareState({ shareId, maxDownloads: 3 });

      const res1 = await incrementDownload(shareId, 3);
      expect(res1.allowed).toBe(true);
      expect(res1.currentCount).toBe(1);
      expect(res1.limit).toBe(3);

      const res2 = await incrementDownload(shareId, 3);
      expect(res2.allowed).toBe(true);
      expect(res2.currentCount).toBe(2);

      const res3 = await incrementDownload(shareId, 3);
      expect(res3.allowed).toBe(true);
      expect(res3.currentCount).toBe(3);
    });

    it('should reject requests exceeding maxDownloads with allowed=false', async () => {
      const shareId = 'mock-share-downloads-002';
      const maxDownloads = 2;
      await initShareState({ shareId, maxDownloads });

      // Download 1
      const d1 = await incrementDownload(shareId, maxDownloads);
      expect(d1.allowed).toBe(true);

      // Download 2 (reaches limit)
      const d2 = await incrementDownload(shareId, maxDownloads);
      expect(d2.allowed).toBe(true);
      expect(d2.currentCount).toBe(2);

      // Download 3 (exceeds limit)
      const d3 = await incrementDownload(shareId, maxDownloads);
      expect(d3.allowed).toBe(false);

      // Download 4 (still exceeds limit)
      const d4 = await incrementDownload(shareId, maxDownloads);
      expect(d4.allowed).toBe(false);
    });

    it('should reject invalid maxDownloads argument with 400', async () => {
      await expect(incrementDownload('share-1', 0)).rejects.toThrow(/positive number/i);
      await expect(incrementDownload('share-1', -5)).rejects.toThrow(/positive number/i);
      await expect(incrementDownload('share-1', 'invalid')).rejects.toThrow(/positive number/i);
    });
  });

  describe('Fail-Closed Security Guarantee (CON-5)', () => {
    it('should fail closed (503 Service Unavailable) when Redis is disconnected', async () => {
      // Disconnect Redis
      _setClientForTest(null, 'disconnected');

      await expect(
        initShareState({ shareId: 'fail-closed-1', oneTime: true })
      ).rejects.toThrow(/Redis unavailable/i);

      await expect(
        consumeOneTime('fail-closed-1')
      ).rejects.toThrow(/Redis unavailable/i);

      await expect(
        incrementDownload('fail-closed-1', 5)
      ).rejects.toThrow(/Redis unavailable/i);

      await expect(
        getShareState('fail-closed-1')
      ).rejects.toThrow(/Redis unavailable/i);

      await expect(
        revokeShareState('fail-closed-1')
      ).rejects.toThrow(/Redis unavailable/i);
    });
  });

  describe('Concurrency & Race Condition Prevention (CON-1, CON-2)', () => {
    it('should permit EXACTLY ONE winner when multiple clients race to consume a one-time share', async () => {
      const shareId = 'race-onetime-share';
      await initShareState({ shareId, oneTime: true });

      // Simulate 20 concurrent requests hitting consumeOneTime at the exact same moment
      const concurrentRequests = 20;
      const promises = Array.from({ length: concurrentRequests }, () =>
        consumeOneTime(shareId)
      );

      const results = await Promise.all(promises);

      const successCount = results.filter((res) => res === true).length;
      const failureCount = results.filter((res) => res === false).length;

      // CON-1 guarantee: EXACTLY ONE succeeds
      expect(successCount).toBe(1);
      expect(failureCount).toBe(concurrentRequests - 1);
    });

    it('should permit EXACTLY maxDownloads winners when concurrent clients race to download', async () => {
      const shareId = 'race-downloads-share';
      const maxDownloads = 5;
      await initShareState({ shareId, maxDownloads });

      // Simulate 25 concurrent requests racing for 5 slots
      const concurrentRequests = 25;
      const promises = Array.from({ length: concurrentRequests }, () =>
        incrementDownload(shareId, maxDownloads)
      );

      const results = await Promise.all(promises);

      const allowedDownloads = results.filter((res) => res.allowed === true);
      const rejectedDownloads = results.filter((res) => res.allowed === false);

      // CON-2 guarantee: EXACTLY maxDownloads succeed
      expect(allowedDownloads).toHaveLength(maxDownloads);
      expect(rejectedDownloads).toHaveLength(concurrentRequests - maxDownloads);

      // Verify counts of allowed downloads cover 1..maxDownloads uniquely
      const counts = allowedDownloads.map((r) => r.currentCount).sort((a, b) => a - b);
      expect(counts).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('getShareState & revokeShareState', () => {
    it('should retrieve current live state and TTL for a share', async () => {
      const shareId = 'inspect-state-share';
      await initShareState({
        shareId,
        oneTime: true,
        maxDownloads: 10,
        expiresAt: new Date(Date.now() + 600 * 1000),
      });

      const state = await getShareState(shareId);
      expect(state.active.exists).toBe(true);
      expect(state.active.value).toBe('1');
      expect(state.downloads.exists).toBe(true);
      expect(state.downloads.count).toBe(0);
    });

    it('should revoke share state by deleting all Redis keys', async () => {
      const shareId = 'revoke-state-share';
      await initShareState({
        shareId,
        oneTime: true,
        maxDownloads: 5,
      });

      const revokeRes = await revokeShareState(shareId);
      expect(revokeRes.success).toBe(true);
      expect(revokeRes.deletedKeys).toBe(2);

      const state = await getShareState(shareId);
      expect(state.active.exists).toBe(false);
      expect(state.downloads.exists).toBe(false);
    });
  });
});
