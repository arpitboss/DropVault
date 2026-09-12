const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const File = require('../src/models/File');
const { connectDB, disconnectDB } = require('../src/config/db');
const { getStorageProvider } = require('../src/storage');
const { decrypt } = require('../src/crypto/encryption');

describe('Text Paste Endpoint POST /api/files (V0-T09)', () => {
  const storedNamesToCleanup = [];

  beforeAll(async () => {
    await connectDB(config.mongoUri);
  });

  afterAll(async () => {
    const storageProvider = getStorageProvider();
    for (const storedName of storedNamesToCleanup) {
      await storageProvider.delete(storedName).catch(() => {});
    }
    await File.deleteMany({ originalName: /^paste-/ });
    await disconnectDB();
  });

  describe('Happy Path Text Paste', () => {
    it('should accept JSON text paste, encrypt on disk, and store metadata in DB', async () => {
      const secretText = 'export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
      const textByteLength = Buffer.byteLength(secretText, 'utf8');

      const response = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
          content: secretText,
        })
        .set('Content-Type', 'application/json')
        .expect('Content-Type', /json/)
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('fileId');
      expect(response.body).toHaveProperty('originalName');
      expect(response.body.originalName).toMatch(/^paste-\d+$/);
      expect(response.body).toHaveProperty('size', textByteLength);
      expect(response.body).toHaveProperty('createdAt');

      const { fileId } = response.body;

      // Verify MongoDB document
      const fileDoc = await File.findById(fileId);
      expect(fileDoc).not.toBeNull();
      expect(fileDoc.mimeType).toBe('text/plain');
      expect(fileDoc.originalName).toMatch(/^paste-\d+$/);
      expect(fileDoc.size).toBe(textByteLength);
      expect(fileDoc.storedName).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Verify encryption envelope
      expect(fileDoc.encryptionMetadata).toBeDefined();
      expect(typeof fileDoc.encryptionMetadata.iv).toBe('string');
      expect(typeof fileDoc.encryptionMetadata.authTag).toBe('string');
      expect(typeof fileDoc.encryptionMetadata.encryptedDEK).toBe('string');

      storedNamesToCleanup.push(fileDoc.storedName);

      // Verify file on disk is encrypted
      const storageProvider = getStorageProvider();
      const storedBuffer = await storageProvider.retrieve(fileDoc.storedName);

      expect(storedBuffer.toString('utf8')).not.toContain('AWS_SECRET_ACCESS_KEY');

      // Verify round-trip decryption
      const decryptedBuffer = await decrypt(storedBuffer, fileDoc.encryptionMetadata);
      expect(decryptedBuffer.toString('utf8')).toBe(secretText);
    });

    it('should handle multi-line text and unicode characters correctly', async () => {
      const unicodeSecret = `
        {
          "emoji": "🚀🔐✨",
          "greek": "Γειά σου Κόσμε",
          "japanese": "機密データ",
          "notes": "Line 1\\nLine 2\\nLine 3"
        }
      `;

      const response = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
          content: unicodeSecret,
        })
        .expect(201);

      const fileDoc = await File.findById(response.body.fileId);
      expect(fileDoc).not.toBeNull();
      storedNamesToCleanup.push(fileDoc.storedName);

      const storageProvider = getStorageProvider();
      const storedBuffer = await storageProvider.retrieve(fileDoc.storedName);
      const decryptedBuffer = await decrypt(storedBuffer, fileDoc.encryptionMetadata);

      expect(decryptedBuffer.toString('utf8')).toBe(unicodeSecret);
    });
  });

  describe('Validation & Error Scenarios', () => {
    it('should return 400 when text content is empty', async () => {
      const response = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
          content: '',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Text content cannot be empty');
    });

    it('should return 400 when text content is only whitespace', async () => {
      const response = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
          content: '   \n\t  ',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Text content cannot be empty');
    });

    it('should return 400 when content is missing from body', async () => {
      const response = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Text content cannot be empty');
    });

    it('should return 413 when text content exceeds the 1MB limit', async () => {
      // Allocate string exceeding 1MB (e.g. 1MB + 1KB)
      const oversizedText = 'A'.repeat(config.maxTextSize + 1024);

      const response = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
          content: oversizedText,
        })
        .expect(413);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toMatch(/exceeds maximum limit/i);
    });
  });
});
