const fs = require('fs');
const path = require('path');
const {
  StorageProvider,
  LocalStorageProvider,
  getStorageProvider,
} = require('../src/storage');

describe('Storage Abstraction Layer (V0-T03)', () => {
  const testDir = path.join(__dirname, 'temp_storage_test');
  let provider;

  beforeAll(async () => {
    provider = new LocalStorageProvider({ uploadDir: testDir });
    await provider.ensureDirectoryExists();
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error if already removed
    }
  });

  describe('StorageProvider Base Class (STO-1, STO-3)', () => {
    class IncompleteProvider extends StorageProvider {}

    it('should throw error when calling unimplemented base methods', async () => {
      const base = new IncompleteProvider();
      await expect(base.save(Buffer.from('test'))).rejects.toThrow('save() must be implemented');
      await expect(base.retrieve('test-id')).rejects.toThrow('retrieve() must be implemented');
      await expect(base.delete('test-id')).rejects.toThrow('delete() must be implemented');
      await expect(base.exists('test-id')).rejects.toThrow('exists() must be implemented');
    });
  });

  describe('LocalStorageProvider (STO-2, STO-3, UPL-2)', () => {
    it('should reject instantiation without uploadDir', () => {
      expect(() => new LocalStorageProvider()).toThrow('requires uploadDir');
    });

    it('should save a buffer and return a valid UUID storedName and storagePath', async () => {
      const content = Buffer.from('Hello DropVault Ephemeral Storage!');
      const result = await provider.save(content);

      expect(result).toHaveProperty('storedName');
      expect(result).toHaveProperty('storagePath');

      // Verify storedName is a valid UUID v4
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(result.storedName).toMatch(uuidV4Regex);

      // Verify file exists on disk at storagePath
      const fileExists = await provider.exists(result.storedName);
      expect(fileExists).toBe(true);

      // Clean up
      await provider.delete(result.storedName);
    });

    it('should reject saving non-Buffer data with TypeError', async () => {
      await expect(provider.save('string-not-buffer')).rejects.toThrow(TypeError);
      await expect(provider.save({ foo: 'bar' })).rejects.toThrow(TypeError);
    });

    it('should retrieve exact content saved to storage', async () => {
      const rawContent = Buffer.from('Binary content \x00\x01\x02\xFF with UTF-8: 🚀🔒');
      const { storedName } = await provider.save(rawContent);

      const retrieved = await provider.retrieve(storedName);
      expect(Buffer.isBuffer(retrieved)).toBe(true);
      expect(retrieved.equals(rawContent)).toBe(true);

      await provider.delete(storedName);
    });

    it('should return false for exists on deleted or non-existent file', async () => {
      const nonExistentId = '12345678-1234-4234-8234-1234567890ab';
      expect(await provider.exists(nonExistentId)).toBe(false);
    });

    it('should throw ENOENT when retrieving a non-existent file', async () => {
      const nonExistentId = '12345678-1234-4234-8234-1234567890ab';
      await expect(provider.retrieve(nonExistentId)).rejects.toThrow('File not found');
    });

    it('should delete an existing file and confirm it no longer exists', async () => {
      const content = Buffer.from('Ephemeral content to be deleted');
      const { storedName } = await provider.save(content);

      expect(await provider.exists(storedName)).toBe(true);

      const deleted = await provider.delete(storedName);
      expect(deleted).toBe(true);

      expect(await provider.exists(storedName)).toBe(false);
    });

    it('should return false when deleting a non-existent file', async () => {
      const nonExistentId = '12345678-1234-4234-8234-1234567890ab';
      const deleted = await provider.delete(nonExistentId);
      expect(deleted).toBe(false);
    });
  });

  describe('Path Traversal Prevention (UPL-4)', () => {
    const maliciousNames = [
      '../outside.txt',
      '..\\outside.txt',
      '../../etc/passwd',
      '..\\..\\windows\\win.ini',
      'subfolder/file.txt',
      'subfolder\\file.txt',
      '/absolute/path/file.txt',
      'C:\\Windows\\System32\\calc.exe',
      'valid-id\0malicious',
      '',
    ];

    test.each(maliciousNames)('should block path traversal attempt: %s', async (maliciousName) => {
      expect(() => provider._resolveSafePath(maliciousName)).toThrow(/path traversal|Invalid stored name/i);
      await expect(provider.retrieve(maliciousName)).rejects.toThrow(/path traversal|Invalid stored name/i);
      await expect(provider.delete(maliciousName)).rejects.toThrow(/path traversal|Invalid stored name/i);
      await expect(provider.exists(maliciousName)).rejects.toThrow(/path traversal|Invalid stored name/i);
    });
  });

  describe('Factory (getStorageProvider)', () => {
    it('should return a LocalStorageProvider instance by default', () => {
      const instance = getStorageProvider();
      expect(instance).toBeInstanceOf(LocalStorageProvider);
      expect(instance).toBeInstanceOf(StorageProvider);
    });

    it('should support custom uploadDir option via factory', () => {
      const customDir = path.join(testDir, 'custom');
      const instance = getStorageProvider({ uploadDir: customDir });
      expect(instance.uploadDir).toBe(path.resolve(customDir));
    });
  });
});
