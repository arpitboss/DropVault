const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const File = require('../src/models/File');
const Share = require('../src/models/Share');
const { connectDB, disconnectDB } = require('../src/config/db');
const { getStorageProvider } = require('../src/storage');
const { encrypt } = require('../src/crypto/encryption');
const { processFileUpload, processTextPaste } = require('../src/services/fileService');
const { createShare } = require('../src/services/shareService');
const { generateShareToken } = require('../src/utils/tokenGenerator');

describe('Share Access & File Download Endpoint GET /s/:shortCode (V0-T11)', () => {
  const storedNamesToCleanup = [];
  const fileIdsToCleanup = [];

  beforeAll(async () => {
    await connectDB(config.mongoUri);
  });

  afterAll(async () => {
    const storageProvider = getStorageProvider();
    for (const storedName of storedNamesToCleanup) {
      await storageProvider.delete(storedName).catch(() => {});
    }
    await Share.deleteMany({ fileId: { $in: fileIdsToCleanup } });
    await File.deleteMany({ _id: { $in: fileIdsToCleanup } });
    await disconnectDB();
  });

  describe('Happy Path Downloads', () => {
    it('should download an encrypted file, decrypting it to original plain content with attachment header', async () => {
      // 1. Ingest sample file
      const originalText = 'CONFIDENTIAL INFRASTRUCTURE CREDENTIALS 987654';
      const plainBuffer = Buffer.from(originalText, 'utf8');
      const fileDesc = await processTextPaste(originalText);
      fileIdsToCleanup.push(fileDesc.fileId);

      const fileDoc = await File.findById(fileDesc.fileId);
      storedNamesToCleanup.push(fileDoc.storedName);

      // 2. Create share
      const share = await createShare({ fileId: fileDesc.fileId });

      // 3. Access share
      const response = await request(app)
        .get(`/s/${share.shortCode}`)
        .expect(200);

      // Verify headers
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain(fileDoc.originalName);

      // Verify content matches
      const responseText = response.text || response.body.toString('utf8');
      expect(responseText).toBe(originalText);
    });

    it('should download a binary payload and preserve byte-for-byte fidelity', async () => {
      // Ingest 4KB binary payload via storage provider and File model directly
      const binaryData = crypto.randomBytes(4096);
      const { encryptedBuffer, encryptionMetadata } = await encrypt(binaryData);

      const storageProvider = getStorageProvider();
      const { storedName, storagePath } = await storageProvider.save(encryptedBuffer, {
        originalName: 'test-binary.bin',
        mimeType: 'application/octet-stream',
      });
      storedNamesToCleanup.push(storedName);

      const fileDoc = await File.create({
        originalName: 'test-binary.bin',
        storedName,
        size: binaryData.length,
        mimeType: 'application/octet-stream',
        storagePath,
        encryptionMetadata,
      });
      fileIdsToCleanup.push(fileDoc._id);

      const share = await createShare({ fileId: fileDoc._id });

      const response = await request(app)
        .get(`/s/${share.shortCode}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(response.headers['content-type']).toContain('application/octet-stream');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('test-binary.bin');
      expect(response.body).toEqual(binaryData);
    });
  });

  describe('Policy Enforcement (One-Time & Expiration)', () => {
    it('should allow download once and return 410 on subsequent attempts for one-time shares', async () => {
      const secret = 'single-use-one-time-token-secret';
      const fileDesc = await processTextPaste(secret);
      fileIdsToCleanup.push(fileDesc.fileId);

      const fileDoc = await File.findById(fileDesc.fileId);
      storedNamesToCleanup.push(fileDoc.storedName);

      // Create one-time share
      const share = await createShare({ fileId: fileDesc.fileId, oneTime: true });

      // First attempt: MUST succeed with 200
      const firstResponse = await request(app)
        .get(`/s/${share.shortCode}`)
        .expect(200);

      const firstResponseText = firstResponse.text || firstResponse.body.toString('utf8');
      expect(firstResponseText).toBe(secret);

      // Verify DB consumedAt is recorded
      const updatedShare = await Share.findOne({ shortCode: share.shortCode });
      expect(updatedShare.consumedAt).not.toBeNull();
      expect(updatedShare.consumedAt).toBeInstanceOf(Date);

      // Second attempt: MUST return 410 Gone
      const secondResponse = await request(app)
        .get(`/s/${share.shortCode}`)
        .expect(410);

      expect(secondResponse.body).toHaveProperty('error', 'Share has already been consumed');
    });

    it('should return 410 Gone when share has expired', async () => {
      const secret = 'expired-secret-payload';
      const fileDesc = await processTextPaste(secret);
      fileIdsToCleanup.push(fileDesc.fileId);

      const fileDoc = await File.findById(fileDesc.fileId);
      storedNamesToCleanup.push(fileDoc.storedName);

      // Create share and artificially expire it in the past
      const share = await createShare({ fileId: fileDesc.fileId });
      await Share.updateOne(
        { shortCode: share.shortCode },
        { expiresAt: new Date(Date.now() - 60000) } // 1 minute in the past
      );

      const response = await request(app)
        .get(`/s/${share.shortCode}`)
        .expect(410);

      expect(response.body).toHaveProperty('error', 'Share has expired');
    });
  });

  describe('Invalid ShortCode & Error Scenarios', () => {
    it('should return 404 when shortCode format is invalid', async () => {
      const response = await request(app)
        .get('/s/too-short')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Share not found');
    });

    it('should return 404 when shortCode is formatted correctly but does not exist', async () => {
      const nonExistentToken = generateShareToken();

      const response = await request(app)
        .get(`/s/${nonExistentToken}`)
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Share not found');
    });
  });
});
