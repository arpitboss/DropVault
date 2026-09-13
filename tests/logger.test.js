const crypto = require('crypto');
const {
  logger,
  Logger,
  formatEntry,
  sanitizeData,
  sanitizeUri,
  maskToken,
} = require('../src/utils/logger');
const { sanitizeUrl } = require('../src/middleware/requestLogger');

describe('Structured Logging & LOG-2 Sanitization (V0-T13)', () => {
  describe('formatEntry Structure (LOG-1)', () => {
    it('should format a valid structured log entry with timestamp, level, and message', () => {
      const entry = formatEntry('info', 'File uploaded successfully', { fileId: 'file-123' });

      expect(entry).toHaveProperty('timestamp');
      expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('File uploaded successfully');
      expect(entry.meta).toEqual({ fileId: 'file-123' });
    });

    it('should omit meta property if no metadata is provided', () => {
      const entry = formatEntry('info', 'Server listening');
      expect(entry.meta).toBeUndefined();
    });
  });

  describe('LOG-2 Sensitive Data Sanitization', () => {
    it('should mask 43-character bearer/share tokens', () => {
      const token = crypto.randomBytes(32).toString('base64url');
      const masked = maskToken(token);

      expect(masked).toBe(`${token.slice(0, 6)}...[REDACTED]`);
      expect(masked).not.toContain(token.slice(6));
    });

    it('should mask short secret strings entirely', () => {
      expect(maskToken('shortsecret')).toBe('[REDACTED]');
    });

    it('should sanitize MongoDB connection strings containing credentials', () => {
      const rawUri = 'mongodb://app_user:superSecretPassword123@localhost:27017/dropvault?authSource=admin';
      const cleanUri = sanitizeUri(rawUri);

      expect(cleanUri).not.toContain('superSecretPassword123');
      expect(cleanUri).toBe('mongodb://app_user:***@localhost:27017/dropvault?authSource=admin');
    });

    it('should recursively sanitize sensitive keys in nested metadata objects', () => {
      const rawPayload = {
        userId: 'usr-987',
        password: 'PlainTextPassword!',
        secret: 'UltraSensitiveMasterToken',
        key: '32byteencryptionkeyinplaintext!!',
        token: 'longtokengreaterthanthirtytwocharacterslength12345',
        nested: {
          content: 'Secret text content from paste endpoint',
          buffer: Buffer.from('binary-data'),
          safeField: 'This is safe to log',
        },
      };

      const sanitized = sanitizeData(rawPayload);

      expect(sanitized.userId).toBe('usr-987');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.secret).toBe('[REDACTED]');
      expect(sanitized.key).toBe('32byte...[REDACTED]');
      expect(sanitized.token).toBe('longto...[REDACTED]');
      expect(sanitized.nested.content).toBe('Secret...[REDACTED]');
      expect(sanitized.nested.buffer).toBe('[REDACTED]');
      expect(sanitized.nested.safeField).toBe('This is safe to log');
    });

    it('should sanitize arrays of objects', () => {
      const items = [
        { name: 'Item 1', password: 'secretpassword1' },
        { name: 'Item 2', password: 'secretpassword2' },
      ];

      const cleaned = sanitizeData(items);
      expect(cleaned[0].password).toBe('[REDACTED]');
      expect(cleaned[1].password).toBe('[REDACTED]');
      expect(cleaned[0].name).toBe('Item 1');
    });
  });

  describe('sanitizeUrl in Request Logger (LOG-2)', () => {
    it('should mask full shortCode tokens in URL paths', () => {
      const token = crypto.randomBytes(32).toString('base64url');
      const rawUrl = `/s/${token}`;
      const cleanUrl = sanitizeUrl(rawUrl);

      expect(cleanUrl).toBe(`/s/${token.slice(0, 6)}...[REDACTED]`);
      expect(cleanUrl).not.toContain(token.slice(6));
    });

    it('should leave non-share routes untouched', () => {
      expect(sanitizeUrl('/health')).toBe('/health');
      expect(sanitizeUrl('/api/files')).toBe('/api/files');
      expect(sanitizeUrl('/access.html?code=abc')).toBe('/access.html?code=abc');
    });
  });

  describe('Logger Instance & Level Filtering', () => {
    it('should log messages with appropriate console methods', () => {
      const spyInfo = jest.spyOn(console, 'log').mockImplementation(() => {});
      const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});

      const testLogger = new Logger();

      // Temporarily override LOG_LEVEL
      process.env.LOG_LEVEL = 'debug';

      testLogger.info('Info message', { test: true });
      expect(spyInfo).toHaveBeenCalled();

      testLogger.warn('Warning message');
      expect(spyWarn).toHaveBeenCalled();

      testLogger.error('Error message');
      expect(spyError).toHaveBeenCalled();

      delete process.env.LOG_LEVEL;
      spyInfo.mockRestore();
      spyWarn.mockRestore();
      spyError.mockRestore();
    });
  });
});
