const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const config = require('../src/config');
const File = require('../src/models/File');
const Share = require('../src/models/Share');
const { connectDB, disconnectDB } = require('../src/config/db');
const { isTokenValidFormat } = require('../src/utils/tokenGenerator');

describe('Share Creation Endpoint POST /api/shares (V0-T10, V1-T08)', () => {
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
      const pasteFile = await File.create({
        originalName: `paste-${Date.now()}-${Math.random().toString(36).substring(7)}`,
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

      const response = await request(app)
        .post('/api/shares')
        .send({
          fileId: pasteFile._id.toString(),
        })
        .expect(201);

      expect(response.body.type).toBe('text');
      await Share.deleteMany({ fileId: pasteFile._id });
      await File.deleteOne({ _id: pasteFile._id });
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

  describe('V1-T08 Share Creation Policy Extensions', () => {
    describe('Password Protection', () => {
      it('should create share with password and store bcrypt hash in DB, returning hasPassword=true', async () => {
        const plainPassword = 'SuperSecretPassword123!';

        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            password: plainPassword,
          })
          .expect(201);

        expect(response.body).toHaveProperty('hasPassword', true);
        // Crucial security requirement: password and passwordHash must NEVER be returned in response
        expect(response.body).not.toHaveProperty('password');
        expect(response.body).not.toHaveProperty('passwordHash');

        // Verify persisted document in MongoDB
        const shareDoc = await Share.findById(response.body.shareId);
        expect(shareDoc).not.toBeNull();
        expect(shareDoc.passwordHash).toBeDefined();
        expect(shareDoc.passwordHash).not.toBe(plainPassword);
        expect(shareDoc.passwordHash.startsWith('$2')).toBe(true);

        // Verify bcrypt hash matches the original password
        const isMatch = await bcrypt.compare(plainPassword, shareDoc.passwordHash);
        expect(isMatch).toBe(true);

        // Verify mismatch with wrong password
        const isWrong = await bcrypt.compare('WrongPassword', shareDoc.passwordHash);
        expect(isWrong).toBe(false);
      });

      it('should return hasPassword=false and passwordHash=null when password is not supplied', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
          })
          .expect(201);

        expect(response.body).toHaveProperty('hasPassword', false);
        expect(response.body).not.toHaveProperty('passwordHash');

        const shareDoc = await Share.findById(response.body.shareId);
        expect(shareDoc.passwordHash).toBeNull();
      });

      it('should reject empty or whitespace-only password with 400', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            password: '   ',
          })
          .expect(400);

        expect(response.body.error).toMatch(/non-empty string/i);
      });

      it('should reject password shorter than 4 characters with 400', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            password: '123',
          })
          .expect(400);

        expect(response.body.error).toMatch(/at least 4 characters/i);
      });
    });

    describe('IP Allow & Deny Lists', () => {
      it('should create share with valid ipAllow and ipDeny lists', async () => {
        const ipAllow = ['192.168.1.100', '10.0.0.0/8', '::1'];
        const ipDeny = ['203.0.113.0/24', '198.51.100.1'];

        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            ipAllow,
            ipDeny,
          })
          .expect(201);

        expect(response.body.ipAllow).toEqual(ipAllow);
        expect(response.body.ipDeny).toEqual(ipDeny);

        const shareDoc = await Share.findById(response.body.shareId);
        expect(shareDoc.ipAllow).toEqual(ipAllow);
        expect(shareDoc.ipDeny).toEqual(ipDeny);
      });

      it('should reject ipAllow when it is not an array', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            ipAllow: '192.168.1.1',
          })
          .expect(400);

        expect(response.body.error).toMatch(/ipAllow must be an array/i);
      });

      it('should reject ipDeny when it is not an array', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            ipDeny: '10.0.0.1',
          })
          .expect(400);

        expect(response.body.error).toMatch(/ipDeny must be an array/i);
      });

      it('should reject ipAllow containing invalid IP or CIDR strings', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            ipAllow: ['192.168.1.1', 'not-a-valid-ip', '10.0.0.0/8'],
          })
          .expect(400);

        expect(response.body.error).toMatch(/invalid ip address or cidr/i);
      });

      it('should reject ipDeny containing invalid IP or CIDR strings', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            ipDeny: ['999.999.999.999'],
          })
          .expect(400);

        expect(response.body.error).toMatch(/invalid ip address or cidr/i);
      });
    });

    describe('maxDownloads Policy', () => {
      it('should create share with valid maxDownloads integer and default downloadCount to 0', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            maxDownloads: 5,
          })
          .expect(201);

        expect(response.body.maxDownloads).toBe(5);
        expect(response.body.downloadCount).toBe(0);

        const shareDoc = await Share.findById(response.body.shareId);
        expect(shareDoc.maxDownloads).toBe(5);
        expect(shareDoc.downloadCount).toBe(0);
      });

      it('should reject maxDownloads less than 1 with 400', async () => {
        const responseZero = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            maxDownloads: 0,
          })
          .expect(400);

        expect(responseZero.body.error).toMatch(/positive integer/i);

        const responseNegative = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            maxDownloads: -3,
          })
          .expect(400);

        expect(responseNegative.body.error).toMatch(/positive integer/i);
      });

      it('should reject non-integer maxDownloads with 400', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            maxDownloads: 2.5,
          })
          .expect(400);

        expect(response.body.error).toMatch(/positive integer/i);
      });

      it('should reject non-numeric maxDownloads with 400', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            maxDownloads: 'unlimited',
          })
          .expect(400);

        expect(response.body.error).toMatch(/positive integer/i);
      });

      it('should reject oneTime=true combined with maxDownloads > 1', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            oneTime: true,
            maxDownloads: 5,
          })
          .expect(400);

        expect(response.body.error).toMatch(/mutually exclusive|cannot specify both/i);
      });
    });

    describe('Dual-Mode Architecture & Ownership', () => {
      it('should default ownerId to null for anonymous shares', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
          })
          .expect(201);

        expect(response.body.ownerId).toBeNull();

        const shareDoc = await Share.findById(response.body.shareId);
        expect(shareDoc.ownerId).toBeNull();
      });
    });

    describe('Combined Policies', () => {
      it('should create a share with all policies combined (password + ipAllow + ipDeny + maxDownloads + expiresIn)', async () => {
        const response = await request(app)
          .post('/api/shares')
          .send({
            fileId: sampleFile._id.toString(),
            password: 'FullSecurityPolicy2026!',
            ipAllow: ['192.168.0.0/16', '127.0.0.1'],
            ipDeny: ['192.168.1.50'],
            maxDownloads: 3,
            expiresIn: 7200,
          })
          .expect(201);

        expect(response.body.hasPassword).toBe(true);
        expect(response.body.ipAllow).toEqual(['192.168.0.0/16', '127.0.0.1']);
        expect(response.body.ipDeny).toEqual(['192.168.1.50']);
        expect(response.body.maxDownloads).toBe(3);
        expect(response.body.downloadCount).toBe(0);
        expect(response.body.expiresAt).not.toBeNull();
        expect(response.body).not.toHaveProperty('password');
        expect(response.body).not.toHaveProperty('passwordHash');

        const shareDoc = await Share.findById(response.body.shareId);
        expect(shareDoc.maxDownloads).toBe(3);
        const isMatch = await bcrypt.compare('FullSecurityPolicy2026!', shareDoc.passwordHash);
        expect(isMatch).toBe(true);
      });
    });
  });
});
