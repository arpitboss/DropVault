const { getRedisClient, isRedisConnected } = require('../config/redis');
const { INCR_DOWNLOAD_LIMIT_LUA, GETDEL_LUA } = require('../utils/redisScripts');
const AppError = require('../utils/AppError');

/**
 * Prefix for all share-related Redis keys (RED-3).
 * Example: `share:64f1a2b3c4d5e6f7a8b9c0d1:active`
 */
const SHARE_KEY_PREFIX = 'share';

/**
 * Returns the Redis key for a share's active one-time state.
 * @param {string} shareId
 * @returns {string}
 */
const getActiveKey = (shareId) => `${SHARE_KEY_PREFIX}:${shareId}:active`;

/**
 * Returns the Redis key for a share's download counter.
 * @param {string} shareId
 * @returns {string}
 */
const getDownloadsKey = (shareId) => `${SHARE_KEY_PREFIX}:${shareId}:downloads`;

/**
 * Retrieves the currently active and ready Redis client.
 * Enforces fail-closed security (CON-5): if Redis is disconnected or unready,
 * throws 503 Service Unavailable so no uncoordinated/insecure access can proceed.
 *
 * @returns {Object} Active Redis client
 * @throws {AppError} 503 if Redis is unavailable
 */
const getActiveClient = () => {
  const client = getRedisClient();
  if (!client || !isRedisConnected()) {
    throw AppError.serviceUnavailable(
      'Access control service is temporarily unavailable (Redis unavailable)'
    );
  }
  return client;
};

/**
 * Calculates remaining TTL in seconds from an expiration Date or timestamp.
 *
 * @param {Date|string|number|null} expiresAt
 * @returns {number|null} Seconds remaining (>= 1), or null if no expiration
 */
const calculateTtlSeconds = (expiresAt) => {
  if (!expiresAt) return null;
  const expiryMs = new Date(expiresAt).getTime();
  if (isNaN(expiryMs)) return null;
  const remainingMs = expiryMs - Date.now();
  return Math.max(1, Math.ceil(remainingMs / 1000));
};

/**
 * Initializes access control state in Redis when a share is created (V1-T09).
 *
 * Keys created (RED-3, RED-4):
 * - If oneTime=true: `share:<shareId>:active` set to '1' with TTL
 * - If maxDownloads set: `share:<shareId>:downloads` set to 0 with TTL
 *
 * @param {Object} params
 * @param {string} params.shareId - MongoDB Share document ID
 * @param {boolean} [params.oneTime=false] - Whether share is one-time use
 * @param {number|null} [params.maxDownloads=null] - Maximum allowed downloads
 * @param {Date|string|null} [params.expiresAt=null] - Expiry timestamp
 * @returns {Promise<{ initialized: boolean, keys: string[] }>}
 */
const initShareState = async ({
  shareId,
  oneTime = false,
  maxDownloads = null,
  expiresAt = null,
}) => {
  if (!shareId || typeof shareId !== 'string') {
    throw AppError.badRequest('shareId is required');
  }

  const client = getActiveClient();
  const ttlSeconds = calculateTtlSeconds(expiresAt);
  const initializedKeys = [];

  const pipeline = client.pipeline();

  if (oneTime) {
    const activeKey = getActiveKey(shareId);
    if (ttlSeconds) {
      pipeline.set(activeKey, '1', 'EX', ttlSeconds);
    } else {
      pipeline.set(activeKey, '1');
    }
    initializedKeys.push(activeKey);
  }

  if (maxDownloads !== null && maxDownloads !== undefined && Number(maxDownloads) >= 1) {
    const downloadsKey = getDownloadsKey(shareId);
    if (ttlSeconds) {
      pipeline.set(downloadsKey, 0, 'EX', ttlSeconds);
    } else {
      pipeline.set(downloadsKey, 0);
    }
    initializedKeys.push(downloadsKey);
  }

  if (initializedKeys.length > 0) {
    await pipeline.exec();
  }

  return {
    initialized: initializedKeys.length > 0,
    keys: initializedKeys,
  };
};

/**
 * Atomically consumes a one-time share token using GETDEL (RED-1, CON-1).
 *
 * Guarantees that even under high concurrency, exactly ONE consumer succeeds.
 * All subsequent or simultaneous calls return false.
 *
 * @param {string} shareId
 * @returns {Promise<boolean>} true if successfully consumed; false if already consumed or expired
 */
const consumeOneTime = async (shareId) => {
  if (!shareId || typeof shareId !== 'string') {
    throw AppError.badRequest('shareId is required');
  }

  const client = getActiveClient();
  const activeKey = getActiveKey(shareId);

  let priorValue;
  if (typeof client.getdel === 'function') {
    priorValue = await client.getdel(activeKey);
  } else {
    priorValue = await client.eval(GETDEL_LUA, 1, activeKey);
  }

  // Returns true only if key existed and was set to '1'
  return priorValue === '1';
};

/**
 * Atomically increments the download counter and checks against the maxDownloads limit (RED-2, CON-2).
 *
 * Uses an atomic Redis Lua script to prevent race conditions where concurrent requests
 * could exceed the download limit.
 *
 * @param {string} shareId
 * @param {number} maxDownloads - Maximum downloads permitted (>= 1)
 * @param {Date|string|null} [expiresAt=null] - Optional expiry date for fallback TTL
 * @returns {Promise<{ allowed: boolean, currentCount: number, limit: number }>}
 */
const incrementDownload = async (shareId, maxDownloads, expiresAt = null) => {
  if (!shareId || typeof shareId !== 'string') {
    throw AppError.badRequest('shareId is required');
  }

  const limit = Number(maxDownloads);
  if (isNaN(limit) || limit < 1) {
    throw AppError.badRequest('maxDownloads must be a positive number greater than or equal to 1');
  }

  const client = getActiveClient();
  const downloadsKey = getDownloadsKey(shareId);
  const ttlSeconds = calculateTtlSeconds(expiresAt) || 0;

  const result = await client.eval(
    INCR_DOWNLOAD_LIMIT_LUA,
    1,
    downloadsKey,
    limit,
    ttlSeconds
  );

  const count = Number(result);

  if (count === -1) {
    // Limit exceeded
    return {
      allowed: false,
      currentCount: limit + 1,
      limit,
    };
  }

  return {
    allowed: true,
    currentCount: count,
    limit,
  };
};

/**
 * Retrieves the current live Redis state for a share.
 * Useful for inspection, diagnostics, and debugging.
 *
 * @param {string} shareId
 * @returns {Promise<Object>}
 */
const getShareState = async (shareId) => {
  if (!shareId || typeof shareId !== 'string') {
    throw AppError.badRequest('shareId is required');
  }

  const client = getActiveClient();
  const activeKey = getActiveKey(shareId);
  const downloadsKey = getDownloadsKey(shareId);

  const [activeVal, downloadsVal, activeTtl, downloadsTtl] = await Promise.all([
    client.get(activeKey),
    client.get(downloadsKey),
    client.ttl(activeKey),
    client.ttl(downloadsKey),
  ]);

  return {
    shareId,
    active: {
      exists: activeVal !== null,
      value: activeVal,
      ttl: activeTtl,
    },
    downloads: {
      exists: downloadsVal !== null,
      count: downloadsVal !== null ? Number(downloadsVal) : null,
      ttl: downloadsTtl,
    },
  };
};

/**
 * Revokes all Redis access keys for a share (V1-T12).
 * Purges live state so no subsequent requests can succeed.
 *
 * @param {string} shareId
 * @returns {Promise<{ success: boolean, deletedKeys: number }>}
 */
const revokeShareState = async (shareId) => {
  if (!shareId || typeof shareId !== 'string') {
    throw AppError.badRequest('shareId is required');
  }

  const client = getActiveClient();
  const activeKey = getActiveKey(shareId);
  const downloadsKey = getDownloadsKey(shareId);

  const deletedKeys = await client.del(activeKey, downloadsKey);

  return {
    success: true,
    deletedKeys,
  };
};

module.exports = {
  SHARE_KEY_PREFIX,
  getActiveKey,
  getDownloadsKey,
  initShareState,
  consumeOneTime,
  incrementDownload,
  getShareState,
  revokeShareState,
};
