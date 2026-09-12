const mongoose = require('mongoose');
const Share = require('../src/models/Share');
const File = require('../src/models/File');
const config = require('../src/config');
const { connectDB, disconnectDB } = require('../src/config/db');

describe('Share Model Schema & Validation (V0-T06)', () => {
  let dummyFileId;

  beforeAll(async () => {
    await connectDB(config.mongoUri);
    await Share.syncIndexes();

    // Create a dummy file record to reference
    const dummyFile = await File.create({
      originalName: 'test-file-ref.txt',
      storedName: `ref-stored-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      size: 512,
      mimeType: 'text/plain',
      storagePath: '/uploads/ref-path',
      encryptionMetadata: {
        iv: '0123456789abcdef01234567',
        authTag: '0123456789abcdef0123456789abcdef',
        encryptedDEK: '0123456789abcdef'.repeat(7) + '01234567',
      },
    });
    dummyFileId = dummyFile._id;
  });

  afterAll(async () => {
    await Share.deleteMany({ shortCode: /^test-share-/ });
    if (dummyFileId) {
      await File.findByIdAndDelete(dummyFileId);
    }
    await disconnectDB();
  });

  const getValidSharePayload = () => ({
    fileId: dummyFileId,
    shortCode: `test-share-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  });

  describe('Schema Validation & Defaults', () => {
    it('should validate a complete and valid Share document with defaults', async () => {
      const share = new Share(getValidSharePayload());
      await expect(share.validate()).resolves.toBeUndefined();

      // Check default values
      expect(share.type).toBe('file');
      expect(share.oneTime).toBe(false);
      expect(share.consumedAt).toBeNull();
      expect(share.expiresAt).toBeNull();
      expect(share.createdAt).toBeInstanceOf(Date);
      expect(Date.now() - share.createdAt.getTime()).toBeLessThan(2000);
    });

    it('should accept "text" as valid share type', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        type: 'text',
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.type).toBe('text');
    });

    it('should reject invalid share type with enum error', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        type: 'invalid_type',
      });
      await expect(share.validate()).rejects.toThrow(/not a valid share type/i);
    });

    it('should fail validation when fileId is missing', async () => {
      const payload = getValidSharePayload();
      delete payload.fileId;
      const share = new Share(payload);
      await expect(share.validate()).rejects.toThrow();
    });

    it('should fail validation when shortCode is missing', async () => {
      const payload = getValidSharePayload();
      delete payload.shortCode;
      const share = new Share(payload);
      await expect(share.validate()).rejects.toThrow();
    });

    it('should support setting oneTime=true and expiresAt date', async () => {
      const futureDate = new Date(Date.now() + 24 * 3600 * 1000);
      const share = new Share({
        ...getValidSharePayload(),
        oneTime: true,
        expiresAt: futureDate,
      });

      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.oneTime).toBe(true);
      expect(share.expiresAt).toEqual(futureDate);
    });
  });

  describe('Database Persistence & Index Constraints', () => {
    it('should persist a share and populate referenced File', async () => {
      const payload = getValidSharePayload();
      const created = await Share.create(payload);

      expect(created._id).toBeDefined();

      const found = await Share.findById(created._id).populate('fileId');
      expect(found).not.toBeNull();
      expect(found.shortCode).toEqual(payload.shortCode);
      expect(found.fileId.originalName).toEqual('test-file-ref.txt');
    });

    it('should enforce unique index on shortCode', async () => {
      const payload = getValidSharePayload();
      await Share.create(payload);

      // Duplicate shortCode attempt must reject
      await expect(Share.create(payload)).rejects.toThrow(/E11000|duplicate key/i);
    });
  });
});
