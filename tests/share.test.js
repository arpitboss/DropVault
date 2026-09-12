const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const config = require('../src/config');
const File = require('../src/models/File');
const Share = require('../src/models/Share');
const { connectDB, disconnectDB } = require('../src/config/db');
const { isTokenValidFormat } = require('../src/utils/tokenGenerator');

describe('Share Creation Endpoint POST /api/shares (V0-T10)', () => {
  let sampleFile;
  let sampleTextFile;

  beforeAll(async () => {
    await connectDB(config.mongoUri);

    // Create a mock file document
    sampleFile = await File.create({
      originalName: 'test-share-document.pdf',
      storedName: `stored-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      size: 2048,
      mimeType: 'application/pdf',
      storagePath: '/uploads/stored-pdf',
      encryptionMetadata: {
        iv: '0123456789abcdef01234567',
        authTag: '0123456789abcdef0123456789abcdef',
        encryptedDEK: '0123456789abcdef'.repeat(7) + '01234567',
      },
    });

    // Create a mock paste document
    sampleTextFile = await File.create({
      originalName: `paste-${Date.now()}`,
      storedName: `stored-paste-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      size: 128,
      mimeType: 'text/plain',
      storagePath: '/uploads/stored-paste',
      encryptionMetadata: {
        iv: '0123456789abcdef01234567',
        authTag: '0123456789abcdef0123456789abcdef',
        encryptedDEK: '0123456789abcdef'.repeat(7) + '01234567',
      },
    });
  });

  afterAll(async () => {
    await Share.deleteMany({ fileId: { $in: [sampleFile._id, sampleTextFile._id] } });
    await File.deleteMany({ _id: { $in: [sampleFile._id, sampleTextFile._id] } });
    await disconnectDB();
  });

  describe('Happy Path Share Creation', () => {
    it('should create a standard share for a file with generated shortCode and URL', async () => {
      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleFile._id.toString(),
        })
        .expect('Content-Type', /json/)
        .expect(201);

      // Verify response structure per acceptance criteria
      expect(response.body).toHaveProperty('shareId');
      expect(response.body).toHaveProperty('shortCode');
      expect(response.body).toHaveProperty('shareUrl');
      expect(response.body).toHaveProperty('fileId', sampleFile._id.toString());
      expect(response.body).toHaveProperty('type', 'file');
      expect(response.body).toHaveProperty('oneTime', false);
      expect(response.body).toHaveProperty('expiresAt', null);
      expect(response.body).toHaveProperty('createdAt');

      // Verify token properties (TOK-1..5)
      const { shortCode, shareUrl } = response.body;
      expect(shortCode.length).toBe(43);
      expect(isTokenValidFormat(shortCode)).toBe(true);
      expect(shareUrl).toBe(`/s/${shortCode}`);

      // Verify persisted MongoDB document
      const shareDoc = await Share.findById(response.body.shareId);
      expect(shareDoc).not.toBeNull();
      expect(shareDoc.shortCode).toBe(shortCode);
      expect(shareDoc.fileId.toString()).toBe(sampleFile._id.toString());
      expect(shareDoc.oneTime).toBe(false);
      expect(shareDoc.consumedAt).toBeNull();
    });

    it('should calculate expiresAt date from expiresIn in seconds', async () => {
      const expiresInSeconds = 3600; // 1 hour
      const beforeCall = Date.now();

      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleFile._id.toString(),
          expiresIn: expiresInSeconds,
        })
        .expect(201);

      expect(response.body.expiresAt).not.toBeNull();
      const expiresAtDate = new Date(response.body.expiresAt);
      const expectedTime = beforeCall + expiresInSeconds * 1000;

      // Allow +/- 5 seconds margin for test execution
      expect(Math.abs(expiresAtDate.getTime() - expectedTime)).toBeLessThan(5000);
    });

    it('should configure oneTime: true and persist correctly in DB', async () => {
      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleFile._id.toString(),
          oneTime: true,
        })
        .expect(201);

      expect(response.body.oneTime).toBe(true);

      const shareDoc = await Share.findById(response.body.shareId);
      expect(shareDoc.oneTime).toBe(true);
    });

    it('should automatically infer type="text" for paste files', async () => {
      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleTextFile._id.toString(),
        })
        .expect(201);

      expect(response.body.type).toBe('text');
    });
  });

  describe('Validation & Error Scenarios', () => {
    it('should return 400 when fileId is missing', async () => {
      const response = await request(app)
        .post('/api/shares')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error', 'fileId is required');
    });

    it('should return 404 when fileId does not exist in DB', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: nonExistentId,
        })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'File not found');
    });

    it('should return 404 when fileId is not a valid ObjectId format', async () => {
      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: 'invalid-non-object-id',
        })
        .expect(404);

      expect(response.body).toHaveProperty('error', 'File not found');
    });

    it('should return 400 when expiresIn is zero or negative', async () => {
      const responseZero = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleFile._id.toString(),
          expiresIn: 0,
        })
        .expect(400);

      expect(responseZero.body.error).toMatch(/positive number/i);

      const responseNegative = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleFile._id.toString(),
          expiresIn: -100,
        })
        .expect(400);

      expect(responseNegative.body.error).toMatch(/positive number/i);
    });

    it('should return 400 when expiresIn is not a valid number', async () => {
      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: sampleFile._id.toString(),
          expiresIn: 'not-a-number',
        })
        .expect(400);

      expect(response.body.error).toMatch(/positive number/i);
    });
  });
});
