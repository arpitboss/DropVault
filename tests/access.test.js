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

const RedisMock = require('ioredis-mock');
const { connectRedis, disconnectRedis, _setClientForTest } = require('../src/config/redis');

describe('Share Access & File Download Endpoint GET /s/:shortCode (V0-T11, V1-T10)', () => {
  const storedNamesToCleanup = [];
  const fileIdsToCleanup = [];
  let redisMock;

  beforeAll(async () => {
    await connectDB(config.mongoUri);
    redisMock = new RedisMock();
    await connectRedis(redisMock);
  });

  afterAll(async () => {
    const storageProvider = getStorageProvider();
    for (const storedName of storedNamesToCleanup) {
      await storageProvider.delete(storedName).catch(() => {});
    }
    await Share.deleteMany({ fileId: { $in: fileIdsToCleanup } });
    await File.deleteMany({ _id: { $in: fileIdsToCleanup } });
    await disconnectRedis();
    _setClientForTest(null, 'disconnected');
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

  describe('V1-T10 Access Policy Enforcement', () => {
    describe('Password Protection Policies', () => {
      let passwordFile;
      let passwordShare;
      const secretContent = 'TOP SECRET VAULT DATA 12345';
      const sharePassword = 'VaultAccessPassword2026!';

      beforeAll(async () => {
        const fileDesc = await processTextPaste(secretContent);
        fileIdsToCleanup.push(fileDesc.fileId);
        passwordFile = await File.findById(fileDesc.fileId);
        storedNamesToCleanup.push(passwordFile.storedName);

        passwordShare = await createShare({
          fileId: fileDesc.fileId,
          password: sharePassword,
        });
      });

      it('should return 403 Forbidden with "Password required" when accessing without password', async () => {
        const response = await request(app)
          .get(`/s/${passwordShare.shortCode}`)
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Password required');
      });

      it('should return 403 Forbidden with "Invalid password" when given an incorrect password', async () => {
        const response = await request(app)
          .get(`/s/${passwordShare.shortCode}`)
          .set('X-Share-Password', 'WrongPass123!')
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Invalid password');
      });

      it('should successfully download and decrypt when provided correct password in X-Share-Password header', async () => {
        const response = await request(app)
          .get(`/s/${passwordShare.shortCode}`)
          .set('X-Share-Password', sharePassword)
          .expect(200);

        const text = response.text || response.body.toString('utf8');
        expect(text).toBe(secretContent);
      });

      it('should successfully download when provided correct password in query parameter', async () => {
        const response = await request(app)
          .get(`/s/${passwordShare.shortCode}?password=${encodeURIComponent(sharePassword)}`)
          .expect(200);

        const text = response.text || response.body.toString('utf8');
        expect(text).toBe(secretContent);
      });

      it('should successfully download when provided correct password in POST body', async () => {
        const response = await request(app)
          .post(`/s/${passwordShare.shortCode}`)
          .send({ password: sharePassword })
          .expect(200);

        const text = response.text || response.body.toString('utf8');
        expect(text).toBe(secretContent);
      });

      it('should verify correct password on POST /s/:shortCode/verify without downloading', async () => {
        const response = await request(app)
          .post(`/s/${passwordShare.shortCode}/verify`)
          .send({ password: sharePassword })
          .expect(200);

        expect(response.body).toEqual({ valid: true, verified: true });
      });

      it('should reject wrong password on POST /s/:shortCode/verify with 403', async () => {
        const response = await request(app)
          .post(`/s/${passwordShare.shortCode}/verify`)
          .send({ password: 'IncorrectPassword' })
          .expect(403);

        expect(response.body).toHaveProperty('error', 'Invalid password');
      });
    });

    describe('IP Filtering Policies (ipAllow & ipDeny)', () => {
      it('should reject access from an IP listed in ipDeny with 403', async () => {
        const fileDesc = await processTextPaste('IP DENY SECRET');
        fileIdsToCleanup.push(fileDesc.fileId);
        const fileDoc = await File.findById(fileDesc.fileId);
        storedNamesToCleanup.push(fileDoc.storedName);

        const share = await createShare({
          fileId: fileDesc.fileId,
          ipDeny: ['203.0.113.5', '198.51.100.0/24'],
        });

        // Test exact blocked IP
        const res1 = await request(app)
          .get(`/s/${share.shortCode}`)
          .set('X-Forwarded-For', '203.0.113.5')
          .expect(403);
        expect(res1.body).toHaveProperty('error', 'Access denied by IP policy');

        // Test CIDR blocked IP
        const res2 = await request(app)
          .get(`/s/${share.shortCode}`)
          .set('X-Forwarded-For', '198.51.100.42')
          .expect(403);
        expect(res2.body).toHaveProperty('error', 'Access denied by IP policy');

        // Allowed IP
        const res3 = await request(app)
          .get(`/s/${share.shortCode}`)
          .set('X-Forwarded-For', '10.0.0.1')
          .expect(200);
        expect(res3.text).toBe('IP DENY SECRET');
      });

      it('should only allow access from IPs matching ipAllow list', async () => {
        const fileDesc = await processTextPaste('IP ALLOW SECRET');
        fileIdsToCleanup.push(fileDesc.fileId);
        const fileDoc = await File.findById(fileDesc.fileId);
        storedNamesToCleanup.push(fileDoc.storedName);

        const share = await createShare({
          fileId: fileDesc.fileId,
          ipAllow: ['192.168.1.0/24', '10.5.5.5'],
        });

        // Matching CIDR -> allowed
        const res1 = await request(app)
          .get(`/s/${share.shortCode}`)
          .set('X-Forwarded-For', '192.168.1.88')
          .expect(200);
        expect(res1.text).toBe('IP ALLOW SECRET');

        // Non-matching IP -> blocked 403
        const res2 = await request(app)
          .get(`/s/${share.shortCode}`)
          .set('X-Forwarded-For', '172.16.0.1')
          .expect(403);
        expect(res2.body).toHaveProperty('error', 'Access denied by IP policy');
      });
    });

    describe('Share Revocation Policy', () => {
      it('should return 410 Gone when share has been revoked (revokedAt is set)', async () => {
        const fileDesc = await processTextPaste('REVOCATION TEST DATA');
        fileIdsToCleanup.push(fileDesc.fileId);
        const fileDoc = await File.findById(fileDesc.fileId);
        storedNamesToCleanup.push(fileDoc.storedName);

        const share = await createShare({ fileId: fileDesc.fileId });

        // Revoke the share
        await Share.updateOne(
          { shortCode: share.shortCode },
          { revokedAt: new Date() }
        );

        const response = await request(app)
          .get(`/s/${share.shortCode}`)
          .expect(410);

        expect(response.body).toHaveProperty('error', 'Share has been revoked');
      });
    });

    describe('Download Limit Policy (maxDownloads)', () => {
      it('should enforce maxDownloads limit and return 410 Gone once limit is exhausted', async () => {
        const fileDesc = await processTextPaste('LIMITED DOWNLOAD SECRET');
        fileIdsToCleanup.push(fileDesc.fileId);
        const fileDoc = await File.findById(fileDesc.fileId);
        storedNamesToCleanup.push(fileDoc.storedName);

        const share = await createShare({
          fileId: fileDesc.fileId,
          maxDownloads: 2,
        });

        // 1st download -> 200
        const res1 = await request(app)
          .get(`/s/${share.shortCode}`)
          .expect(200);
        expect(res1.text).toBe('LIMITED DOWNLOAD SECRET');

        // 2nd download -> 200
        const res2 = await request(app)
          .get(`/s/${share.shortCode}`)
          .expect(200);
        expect(res2.text).toBe('LIMITED DOWNLOAD SECRET');

        // 3rd download -> 410 Gone (exhausted)
        const res3 = await request(app)
          .get(`/s/${share.shortCode}`)
          .expect(410);
        expect(res3.body).toHaveProperty('error', 'Download limit has been reached for this share');
      });
    });

    describe('Concurrency Guarantees (CON-1, CON-2)', () => {
      it('should ensure exactly ONE winner when multiple HTTP requests race for a one-time share', async () => {
        const fileDesc = await processTextPaste('CONCURRENCY RACE SECRET');
        fileIdsToCleanup.push(fileDesc.fileId);
        const fileDoc = await File.findById(fileDesc.fileId);
        storedNamesToCleanup.push(fileDoc.storedName);

        const share = await createShare({
          fileId: fileDesc.fileId,
          oneTime: true,
        });

        // Fire 10 concurrent HTTP requests
        const requests = Array.from({ length: 10 }, () =>
          request(app).get(`/s/${share.shortCode}`)
        );

        const responses = await Promise.all(requests);

        const successes = responses.filter((res) => res.status === 200);
        const gones = responses.filter((res) => res.status === 410);

        expect(successes).toHaveLength(1);
        expect(gones).toHaveLength(9);
        expect(successes[0].text).toBe('CONCURRENCY RACE SECRET');
      });
    });
  });
});

