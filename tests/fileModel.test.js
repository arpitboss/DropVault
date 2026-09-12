const mongoose = require('mongoose');
const File = require('../src/models/File');
const config = require('../src/config');
const { connectDB, disconnectDB } = require('../src/config/db');

describe('File Model Schema & Validation (V0-T05)', () => {
  beforeAll(async () => {
    await connectDB(config.mongoUri);
    await File.syncIndexes();
  });

  afterAll(async () => {
    await File.deleteMany({ originalName: /^test-file-/ });
    await disconnectDB();
  });

  const getValidPayload = () => ({
    originalName: 'test-file-sample.txt',
    storedName: `test-stored-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    size: 1024,
    mimeType: 'text/plain',
    storagePath: '/uploads/sample-path',
    encryptionMetadata: {
      iv: '0123456789abcdef01234567',
      authTag: '0123456789abcdef0123456789abcdef',
      encryptedDEK: '0123456789abcdef'.repeat(7) + '01234567',
    },
  });

  describe('Schema Validation', () => {
    it('should validate a complete and valid File document', async () => {
      const file = new File(getValidPayload());
      await expect(file.validate()).resolves.toBeUndefined();
    });

    it('should set default value for createdAt as a valid Date', () => {
      const file = new File(getValidPayload());
      expect(file.createdAt).toBeInstanceOf(Date);
      expect(Date.now() - file.createdAt.getTime()).toBeLessThan(2000);
    });

    it('should set default value for expiresAt as null', () => {
      const file = new File(getValidPayload());
      expect(file.expiresAt).toBeNull();
    });

    it('should allow setting an optional expiresAt Date', () => {
      const futureDate = new Date(Date.now() + 3600 * 1000);
      const file = new File({ ...getValidPayload(), expiresAt: futureDate });
      expect(file.expiresAt).toEqual(futureDate);
    });

    it('should fail validation when originalName is missing', async () => {
      const payload = getValidPayload();
      delete payload.originalName;
      const file = new File(payload);
      await expect(file.validate()).rejects.toThrow();
    });

    it('should fail validation when storedName is missing', async () => {
      const payload = getValidPayload();
      delete payload.storedName;
      const file = new File(payload);
      await expect(file.validate()).rejects.toThrow();
    });

    it('should fail validation when size is missing or negative', async () => {
      const missingSize = new File({ ...getValidPayload(), size: undefined });
      await expect(missingSize.validate()).rejects.toThrow();

      const negativeSize = new File({ ...getValidPayload(), size: -5 });
      await expect(negativeSize.validate()).rejects.toThrow();
    });

    it('should fail validation when mimeType is missing', async () => {
      const payload = getValidPayload();
      delete payload.mimeType;
      const file = new File(payload);
      await expect(file.validate()).rejects.toThrow();
    });

    it('should fail validation when storagePath is missing', async () => {
      const payload = getValidPayload();
      delete payload.storagePath;
      const file = new File(payload);
      await expect(file.validate()).rejects.toThrow();
    });

    it('should fail validation when encryptionMetadata is missing', async () => {
      const payload = getValidPayload();
      delete payload.encryptionMetadata;
      const file = new File(payload);
      await expect(file.validate()).rejects.toThrow();
    });

    it('should fail validation when encryptionMetadata fields are missing', async () => {
      const fileNoIv = new File({
        ...getValidPayload(),
        encryptionMetadata: { authTag: 'tag', encryptedDEK: 'dek' },
      });
      await expect(fileNoIv.validate()).rejects.toThrow();

      const fileNoTag = new File({
        ...getValidPayload(),
        encryptionMetadata: { iv: 'iv', encryptedDEK: 'dek' },
      });
      await expect(fileNoTag.validate()).rejects.toThrow();

      const fileNoDEK = new File({
        ...getValidPayload(),
        encryptionMetadata: { iv: 'iv', authTag: 'tag' },
      });
      await expect(fileNoDEK.validate()).rejects.toThrow();
    });
  });

  describe('Database Persistence & Uniqueness', () => {
    it('should save and retrieve a file document from MongoDB', async () => {
      const payload = getValidPayload();
      const created = await File.create(payload);

      expect(created._id).toBeDefined();
      expect(created.storedName).toEqual(payload.storedName);

      const found = await File.findById(created._id);
      expect(found).not.toBeNull();
      expect(found.originalName).toEqual(payload.originalName);
      expect(found.encryptionMetadata.iv).toEqual(payload.encryptionMetadata.iv);
      expect(found.encryptionMetadata.authTag).toEqual(payload.encryptionMetadata.authTag);
      expect(found.encryptionMetadata.encryptedDEK).toEqual(payload.encryptionMetadata.encryptedDEK);
    });

    it('should enforce unique index on storedName', async () => {
      const payload = getValidPayload();
      await File.create(payload);

      // Attempt creating a second document with duplicate storedName
      await expect(File.create(payload)).rejects.toThrow(/E11000|duplicate key/i);
    });
  });
});
