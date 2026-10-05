const mongoose = require('mongoose');
const Share = require('../src/models/Share');
const File = require('../src/models/File');
const config = require('../src/config');
const { connectDB, disconnectDB } = require('../src/config/db');

describe('Share Model Schema & Validation (V0-T06, V1-T07)', () => {
  let dummyFileId;

  beforeAll(async () => {
    await connectDB(config.mongoUri);
    await Share.syncIndexes();

    // Create a dummy file record to reference
    const dummyFile = await File.create({
      originalName: 'share-model-dummy-ref.txt',
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

  // =======================================================================
  // V0 Schema Validation (preserved from V0-T06)
  // =======================================================================
  describe('V0 Schema Validation & Defaults', () => {
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

  // =======================================================================
  // V1 Extensions (V1-T07)
  // =======================================================================
  describe('V1 Extension Defaults & Backward Compatibility (V1-T07)', () => {
    it('should default all V1 fields correctly when not provided (backward compat)', async () => {
      const share = new Share(getValidSharePayload());
      await expect(share.validate()).resolves.toBeUndefined();

      expect(share.passwordHash).toBeNull();
      expect(share.ipAllow).toEqual([]);
      expect(share.ipDeny).toEqual([]);
      expect(share.maxDownloads).toBeNull();
      expect(share.downloadCount).toBe(0);
      expect(share.revokedAt).toBeNull();
      expect(share.ownerId).toBeNull();
    });

    it('should validate a share with all V1 fields populated', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        passwordHash: '$2b$12$mockBcryptHashStringForTestPurposesOnly1234567890',
        ipAllow: ['192.168.1.0/24', '10.0.0.5'],
        ipDeny: ['203.0.113.0/24'],
        maxDownloads: 5,
        downloadCount: 2,
        revokedAt: null,
        ownerId: new mongoose.Types.ObjectId(),
      });

      await expect(share.validate()).resolves.toBeUndefined();
    });
  });

  describe('passwordHash Field (V1-T07)', () => {
    it('should accept a valid bcrypt hash string', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        passwordHash: '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWX12',
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.passwordHash).toBeDefined();
    });

    it('should accept null (no password protection)', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        passwordHash: null,
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.passwordHash).toBeNull();
    });

    it('should not define a plain password field on the schema', () => {
      expect(Share.schema.paths.password).toBeUndefined();
      expect(Share.schema.paths.passwordHash).toBeDefined();
    });
  });

  describe('ipAllow & ipDeny Validation (V1-T07)', () => {
    it('should accept valid IPv4 addresses in ipAllow', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ipAllow: ['192.168.1.1', '10.0.0.5', '172.16.0.1'],
      });
      await expect(share.validate()).resolves.toBeUndefined();
    });

    it('should accept valid CIDR notation in ipAllow', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ipAllow: ['192.168.1.0/24', '10.0.0.0/8'],
      });
      await expect(share.validate()).resolves.toBeUndefined();
    });

    it('should accept valid IPv6 addresses', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ipAllow: ['::1', 'fe80::1'],
      });
      await expect(share.validate()).resolves.toBeUndefined();
    });

    it('should reject invalid IP formats in ipAllow', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ipAllow: ['not-an-ip', '999.999.999.999'],
      });
      await expect(share.validate()).rejects.toThrow(/valid IP addresses or CIDR/i);
    });

    it('should reject invalid IP formats in ipDeny', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ipDeny: ['invalid_ip_format'],
      });
      await expect(share.validate()).rejects.toThrow(/valid IP addresses or CIDR/i);
    });

    it('should accept empty arrays (default — no IP filtering)', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ipAllow: [],
        ipDeny: [],
      });
      await expect(share.validate()).resolves.toBeUndefined();
    });
  });

  describe('maxDownloads & downloadCount (V1-T07)', () => {
    it('should accept a valid positive maxDownloads value', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        maxDownloads: 10,
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.maxDownloads).toBe(10);
    });

    it('should accept maxDownloads = 1 (minimum)', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        maxDownloads: 1,
      });
      await expect(share.validate()).resolves.toBeUndefined();
    });

    it('should reject maxDownloads = 0 (below minimum)', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        maxDownloads: 0,
      });
      await expect(share.validate()).rejects.toThrow(/at least 1/i);
    });

    it('should reject negative maxDownloads', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        maxDownloads: -5,
      });
      await expect(share.validate()).rejects.toThrow(/at least 1/i);
    });

    it('should default downloadCount to 0', () => {
      const share = new Share(getValidSharePayload());
      expect(share.downloadCount).toBe(0);
    });

    it('should reject negative downloadCount', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        downloadCount: -1,
      });
      await expect(share.validate()).rejects.toThrow(/cannot be negative/i);
    });
  });

  describe('revokedAt Field (V1-T07)', () => {
    it('should default revokedAt to null', () => {
      const share = new Share(getValidSharePayload());
      expect(share.revokedAt).toBeNull();
    });

    it('should accept a valid revocation Date', async () => {
      const revokeDate = new Date();
      const share = new Share({
        ...getValidSharePayload(),
        revokedAt: revokeDate,
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.revokedAt).toEqual(revokeDate);
    });
  });

  describe('ownerId Field — Dual-Mode Architecture (V1-T07)', () => {
    it('should default ownerId to null (anonymous share)', () => {
      const share = new Share(getValidSharePayload());
      expect(share.ownerId).toBeNull();
    });

    it('should accept a valid ObjectId for authenticated shares', async () => {
      const userId = new mongoose.Types.ObjectId();
      const share = new Share({
        ...getValidSharePayload(),
        ownerId: userId,
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.ownerId).toEqual(userId);
    });

    it('should accept null explicitly (anonymous mode)', async () => {
      const share = new Share({
        ...getValidSharePayload(),
        ownerId: null,
      });
      await expect(share.validate()).resolves.toBeUndefined();
      expect(share.ownerId).toBeNull();
    });
  });

  // =======================================================================
  // Database Persistence (preserved from V0-T06 + V1 fields)
  // =======================================================================
  describe('Database Persistence & Index Constraints', () => {
    it('should persist a share and populate referenced File', async () => {
      const payload = getValidSharePayload();
      const created = await Share.create(payload);

      expect(created._id).toBeDefined();

      const found = await Share.findById(created._id).populate('fileId');
      expect(found).not.toBeNull();
      expect(found.shortCode).toEqual(payload.shortCode);
      expect(found.fileId.originalName).toEqual('share-model-dummy-ref.txt');
    });

    it('should enforce unique index on shortCode', async () => {
      const payload = getValidSharePayload();
      await Share.create(payload);

      // Duplicate shortCode attempt must reject
      await expect(Share.create(payload)).rejects.toThrow(/E11000|duplicate key/i);
    });

    it('should persist a share with all V1 fields and retrieve them correctly', async () => {
      const userId = new mongoose.Types.ObjectId();
      const payload = {
        ...getValidSharePayload(),
        passwordHash: '$2b$12$testHashForPersistenceVerification',
        ipAllow: ['10.0.0.0/8'],
        ipDeny: ['192.168.1.100'],
        maxDownloads: 3,
        downloadCount: 1,
        ownerId: userId,
      };

      const created = await Share.create(payload);
      const found = await Share.findById(created._id);

      expect(found.passwordHash).toEqual(payload.passwordHash);
      expect(found.ipAllow).toEqual(['10.0.0.0/8']);
      expect(found.ipDeny).toEqual(['192.168.1.100']);
      expect(found.maxDownloads).toBe(3);
      expect(found.downloadCount).toBe(1);
      expect(found.revokedAt).toBeNull();
      expect(found.ownerId.toString()).toEqual(userId.toString());
    });
  });
});
