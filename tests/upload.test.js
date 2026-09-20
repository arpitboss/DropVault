const request = require('supertest');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = require('../src/app');
const config = require('../src/config');
const File = require('../src/models/File');
const { connectDB, disconnectDB } = require('../src/config/db');
const { getStorageProvider } = require('../src/storage');
const { decrypt } = require('../src/crypto/encryption');
const { TEMP_UPLOAD_DIR } = require('../src/middleware/upload');

describe('File Upload Endpoint POST /api/files (V0-T08)', () => {
  const uploadedFilesToCleanup = [];

  beforeAll(async () => {
    await connectDB(config.mongoUri);
    if (fs.existsSync(TEMP_UPLOAD_DIR)) {
      const files = await fs.promises.readdir(TEMP_UPLOAD_DIR);
      for (const file of files) {
        await fs.promises.unlink(path.join(TEMP_UPLOAD_DIR, file)).catch(() => {});
      }
    }
  });

  afterAll(async () => {
    const storageProvider = getStorageProvider();
    for (const storedName of uploadedFilesToCleanup) {
      await storageProvider.delete(storedName).catch(() => {});
    }
    await File.deleteMany({ originalName: /^test-(upload|binary)-/ });
    await disconnectDB();
  });

  describe('Happy Path File Upload', () => {
    it('should upload a text file, encrypt on disk, and store metadata in DB', async () => {
      const plainContent = 'DropVault: confidential configuration content 12345';
      const plainBuffer = Buffer.from(plainContent, 'utf8');

      const response = await request(app)
        .post('/api/files')
        .attach('file', plainBuffer, 'test-upload-sample.txt')
        .expect('Content-Type', /json/)
        .expect(201);

      // Verify response structure per acceptance criteria
      expect(response.body).toHaveProperty('fileId');
      expect(response.body).toHaveProperty('originalName', 'test-upload-sample.txt');
      expect(response.body).toHaveProperty('size', plainBuffer.length);
      expect(response.body).toHaveProperty('createdAt');

      const { fileId } = response.body;

      // Verify MongoDB document
      const fileDoc = await File.findById(fileId);
      expect(fileDoc).not.toBeNull();
      expect(fileDoc.originalName).toBe('test-upload-sample.txt');
      expect(fileDoc.size).toBe(plainBuffer.length);
      expect(fileDoc.mimeType).toBe('text/plain');
      expect(fileDoc.storedName).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Verify encryption metadata shape
      expect(fileDoc.encryptionMetadata).toBeDefined();
      expect(typeof fileDoc.encryptionMetadata.iv).toBe('string');
      expect(typeof fileDoc.encryptionMetadata.authTag).toBe('string');
      expect(typeof fileDoc.encryptionMetadata.encryptedDEK).toBe('string');

      uploadedFilesToCleanup.push(fileDoc.storedName);

      // Verify encrypted file on disk
      const storageProvider = getStorageProvider();
      const storedBuffer = await storageProvider.retrieve(fileDoc.storedName);

      // File on disk MUST be ciphertext and not equal to plain content (ENC-1, ENC-4)
      expect(storedBuffer).not.toEqual(plainBuffer);
      expect(storedBuffer.toString('utf8')).not.toContain('DropVault: confidential');

      // Verify decryption restores exact original content
      const decryptedBuffer = await decrypt(storedBuffer, fileDoc.encryptionMetadata);
      expect(decryptedBuffer.toString('utf8')).toBe(plainContent);
    });

    it('should upload an arbitrary binary file and round-trip decrypt without corruption', async () => {
      const binaryBuffer = crypto.randomBytes(8192); // 8 KB random binary data

      const response = await request(app)
        .post('/api/files')
        .attach('file', binaryBuffer, 'test-binary-file.bin')
        .expect(201);

      const fileDoc = await File.findById(response.body.fileId);
      expect(fileDoc).not.toBeNull();
      uploadedFilesToCleanup.push(fileDoc.storedName);

      const storageProvider = getStorageProvider();
      const storedBuffer = await storageProvider.retrieve(fileDoc.storedName);
      const decryptedBuffer = await decrypt(storedBuffer, fileDoc.encryptionMetadata);

      expect(decryptedBuffer.equals(binaryBuffer)).toBe(true);
    });

    it('should clean up temporary staging files after upload completes', async () => {
      // Check temp staging directory
      const tempFiles = await fs.promises.readdir(TEMP_UPLOAD_DIR);
      // All temporary files must be cleaned up immediately
      expect(tempFiles.length).toBe(0);
    });
  });

  describe('Validation & Error Scenarios', () => {
    it('should return 400 when no file is provided in request', async () => {
      const response = await request(app)
        .post('/api/files')
        .expect(400);

      expect(response.body).toHaveProperty('error', 'No file uploaded');
    });

    it('should return 413 when file exceeds the maximum allowed upload size (50MB)', async () => {
      // Allocate buffer slightly larger than 50MB
      const oversizedBuffer = Buffer.alloc(config.maxFileSize + 1024);

      const response = await request(app)
        .post('/api/files')
        .attach('file', oversizedBuffer, 'oversized-file.dat')
        .expect(413);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatch(/exceeds the limit/i);
    }, 30000);
  });
});
