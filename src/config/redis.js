const Redis = require('ioredis');
const config = require('./index');
const { logger } = require('../utils/logger');

let client = null;
let status = 'disconnected';

/**
 * Calculates backoff delay for reconnect attempts.
 * In test environments, caps retries to prevent tests hanging on unreachable hosts.
 */
const calculateRetryDelay = (times) => {
  if (config.nodeEnv === 'test' && times > 2) {
    return null; // Stop reconnecting in test runs
  }
  const delay = Math.min(times * 150, 3000);
  return delay;
};

/**
 * Creates and configures an ioredis client instance.
 */
const createClient = (options = {}) => {
  const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: calculateRetryDelay,
    ...options,
  };

  let newClient;
  if (config.redisUrl) {
    newClient = new Redis(config.redisUrl, redisOptions);
  } else {
    newClient = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
      ...redisOptions,
    });
  }

  attachListeners(newClient);
  return newClient;
};

/**
 * Attaches event listeners for state tracking and structured logging.
 */
const attachListeners = (redisClient) => {
  redisClient.on('connect', () => {
    status = 'connected';
    logger.info('[DropVault] Redis socket connected.');
  });

  redisClient.on('ready', () => {
    status = 'ready';
    logger.info('[DropVault] Redis ready to accept commands.');
  });

  redisClient.on('error', (err) => {
    status = 'error';
    logger.error(`[DropVault] Redis connection error: ${err.message}`);
  });

  redisClient.on('close', () => {
    status = 'disconnected';
    logger.warn('[DropVault] Redis connection closed.');
  });

  redisClient.on('reconnecting', () => {
    status = 'reconnecting';
    logger.warn('[DropVault] Redis reconnecting...');
  });
};

/**
 * Connects to Redis with error handling and status tracking (V1-T01).
 *
 * @param {Object} [overrideClient=null] - Optional mock or custom client for testing
 * @returns {Promise<Redis>} Connected Redis client
 */
const connectRedis = async (overrideClient = null) => {
  if (overrideClient) {
    client = overrideClient;
    status = 'ready';
    return client;
  }

  if (client && (status === 'ready' || status === 'connected')) {
    return client;
  }

  status = 'connecting';

  try {
    if (!client) {
      client = createClient();
    }

    await client.connect();
    status = 'ready';
    return client;
  } catch (error) {
    status = 'error';
    logger.error(`[DropVault] Failed to connect to Redis: ${error.message}`);
    throw error;
  }
};

/**
 * Gracefully disconnects the active Redis client.
 */
const disconnectRedis = async () => {
  if (!client) {
    status = 'disconnected';
    return;
  }

  status = 'disconnecting';

  try {
    // Attempt graceful quit with a 2-second timeout
    await Promise.race([
      client.quit(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Redis quit timed out')), 2000)
      ),
    ]);
  } catch (err) {
    logger.warn(`[DropVault] Forcing Redis disconnect: ${err.message}`);
    try {
      client.disconnect();
    } catch (_) {}
  } finally {
    client = null;
    status = 'disconnected';
    logger.info('[DropVault] Redis disconnected successfully.');
  }
};

/**
 * Returns true if Redis is ready or connected.
 */
const isRedisConnected = () => {
  return status === 'ready' || status === 'connected';
};

/**
 * Returns current string status of Redis connection.
 */
const getRedisStatus = () => {
  return status;
};

/**
 * Returns active Redis client instance.
 */
const getRedisClient = () => {
  return client;
};

/**
 * Helper for testing environments to set client and status.
 */
const _setClientForTest = (testClient, testStatus = 'ready') => {
  client = testClient;
  status = testStatus;
};

module.exports = {
  connectRedis,
  disconnectRedis,
  isRedisConnected,
  getRedisStatus,
  getRedisClient,
  createClient,
  calculateRetryDelay,
  _setClientForTest,
};
