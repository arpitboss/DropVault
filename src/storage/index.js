const config = require('../config');
const StorageProvider = require('./StorageProvider');
const LocalStorageProvider = require('./LocalStorageProvider');

let defaultStorageProvider = null;

/**
 * Factory function returning the active StorageProvider instance (STO-1, STO-2).
 * Defaults to LocalStorageProvider configured with UPLOAD_DIR from application config.
 * @param {object} [options={}]
 * @returns {StorageProvider}
 */
const getStorageProvider = (options = {}) => {
  if (options.uploadDir) {
    return new LocalStorageProvider(options);
  }

  if (!defaultStorageProvider) {
    defaultStorageProvider = new LocalStorageProvider({
      uploadDir: config.uploadDir,
    });
  }

  return defaultStorageProvider;
};

module.exports = {
  StorageProvider,
  LocalStorageProvider,
  getStorageProvider,
};
