const mongoose = require('mongoose');

/**
 * Sanitizes MongoDB connection URI to mask credentials before logging.
 * Preserves LOG-2 integrity (never log credentials/passwords).
 */
const sanitizeUri = (uri) => {
  if (!uri) return '';
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/, '$1****$3');
};

/**
 * Map mongoose readyState numbers to readable status strings.
 */
const readyStateMap = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

/**
 * Connect to MongoDB using Mongoose with connection pooling and error handling.
 * @param {string} uri - MongoDB connection string
 * @param {object} options - Optional mongoose connection overrides
 */
const connectDB = async (uri, options = {}) => {
  const defaultOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    ...options,
  };

  try {
    const conn = await mongoose.connect(uri, defaultOptions);
    console.log(`[DropVault] MongoDB connected to ${sanitizeUri(uri)}`);
    return conn;
  } catch (error) {
    console.error(`[DropVault] MongoDB connection failed: ${error.message}`);
    throw error;
  }
};

/**
 * Disconnect from MongoDB gracefully.
 */
const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
    console.log('[DropVault] MongoDB connection closed gracefully.');
  }
};

/**
 * Get the current MongoDB connection status.
 * @returns {string} - 'connected' | 'connecting' | 'disconnecting' | 'disconnected'
 */
const getDBStatus = () => {
  const state = mongoose.connection.readyState;
  return readyStateMap[state] || 'disconnected';
};

/**
 * Check if MongoDB is connected.
 * @returns {boolean}
 */
const isConnected = () => {
  return mongoose.connection.readyState === 1;
};

module.exports = {
  connectDB,
  disconnectDB,
  getDBStatus,
  isConnected,
  sanitizeUri,
};
