const mongoose = require('mongoose');
const config = require('../src/config');
const {
  connectDB,
  disconnectDB,
  getDBStatus,
  isConnected,
  sanitizeUri,
} = require('../src/config/db');

describe('Database Connection Module (src/config/db.js)', () => {
  afterEach(async () => {
    await disconnectDB();
  });

  describe('sanitizeUri', () => {
    it('should mask credentials in MongoDB URI', () => {
      const sensitiveUri = 'mongodb://appUser:superSecretPassword123@localhost:27017/dropvault';
      const sanitized = sanitizeUri(sensitiveUri);
      expect(sanitized).not.toContain('superSecretPassword123');
      expect(sanitized).toContain('****');
    });

    it('should return empty string if uri is falsy', () => {
      expect(sanitizeUri('')).toBe('');
    });
  });

  describe('Connection Lifecycle', () => {
    it('should connect to MongoDB successfully with valid URI', async () => {
      expect(isConnected()).toBe(false);
      expect(getDBStatus()).toBe('disconnected');

      await connectDB(config.mongoUri);

      expect(isConnected()).toBe(true);
      expect(getDBStatus()).toBe('connected');
    });

    it('should handle MongoDB disconnection gracefully', async () => {
      await connectDB(config.mongoUri);
      expect(isConnected()).toBe(true);

      await disconnectDB();
      expect(isConnected()).toBe(false);
      expect(getDBStatus()).toBe('disconnected');
    });

    it('should throw error when connecting to an unreachable host', async () => {
      const unreachableUri = 'mongodb://127.0.0.1:27999/dropvault';
      await expect(
        connectDB(unreachableUri, { serverSelectionTimeoutMS: 1000 })
      ).rejects.toThrow();
      expect(isConnected()).toBe(false);
    });
  });
});
