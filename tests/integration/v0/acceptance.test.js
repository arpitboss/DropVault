const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = require('../../../src/app');
const config = require('../../../src/config');
const { connectDB, disconnectDB } = require('../../../src/config/db');
const File = require('../../../src/models/File');
const Share = require('../../../src/models/Share');
const { getStorageProvider } = require('../../../src/storage');

describe('V0 Acceptance Integration Suite (V0-T15)', () => {
  const fileIdsToCleanup = [];
  const storedNamesToCleanup = [];

  beforeAll(async () => {
    await connectDB(config.mongoUri);
  });

  afterAll(async () => {
    // Clean up MongoDB test documents
    if (fileIdsToCleanup.length > 0) {
      await File.deleteMany({ _id: { $in: fileIdsToCleanup } });
      await Share.deleteMany({ fileId: { $in: fileIdsToCleanup } });
    }

    // Clean up physical files from storage
    const storageProvider = getStorageProvider();
    for (const storedName of storedNamesToCleanup) {
      try {
        await storageProvider.delete(storedName);
      } catch (_) {}
    }

    await disconnectDB();
  });

  describe('Scenario 1: End-to-End File Upload, One-Time Share, and Destruction', () => {
    it('should complete full lifecycle: upload -> encrypt -> share -> download -> burn', async () => {
      // 1. Generate 16KB of pseudo-random binary data
      const originalBinaryData = crypto.randomBytes(16 * 1024);
      const filename = 'acceptance-payload.dat';

      // 2. Upload file via POST /api/files (V0-T08)
      const uploadRes = await request(app)
        .post('/api/files')
        .attach('file', originalBinaryData, filename)
        .expect(201);

      expect(uploadRes.body).toHaveProperty('fileId');
      expect(uploadRes.body.originalName).toBe(filename);
      expect(uploadRes.body.size).toBe(originalBinaryData.length);
      expect(uploadRes.headers['x-request-id']).toBeDefined();

      const { fileId } = uploadRes.body;
      fileIdsToCleanup.push(fileId);

      // 3. Inspect database metadata (V0-T05)
      const fileDoc = await File.findById(fileId);
      expect(fileDoc).not.toBeNull();
      expect(fileDoc.storedName).toBeDefined();
      expect(fileDoc.encryptionMetadata.iv).toBeDefined();
      expect(fileDoc.encryptionMetadata.authTag).toBeDefined();
      expect(fileDoc.encryptionMetadata.encryptedDEK).toBeDefined();
      storedNamesToCleanup.push(fileDoc.storedName);

      // 4. Verify encryption-at-rest: file on disk MUST NOT match plaintext (ENC-1, ENC-4)
      const diskPath = path.join(config.uploadDir, fileDoc.storedName);
      const diskCiphertext = await fs.promises.readFile(diskPath);
      expect(diskCiphertext.equals(originalBinaryData)).toBe(false);

      // 5. Create One-Time Ephemeral Share (V0-T10)
      const shareRes = await request(app)
        .post('/api/shares')
        .send({
          fileId,
          oneTime: true,
          expiresIn: 3600,
        })
        .expect(201);

      expect(shareRes.body).toHaveProperty('shareId');
      expect(shareRes.body).toHaveProperty('shortCode');
      expect(shareRes.body.shareUrl).toBe(`/s/${shareRes.body.shortCode}`);
      expect(shareRes.body.oneTime).toBe(true);
      expect(shareRes.body.type).toBe('file');

      const { shortCode } = shareRes.body;

      // 6. Download file via GET /s/:shortCode (V0-T11)
      const downloadRes = await request(app)
        .get(`/s/${shortCode}`)
        .buffer(true)
        .parse((res, callback) => {
          const data = [];
          res.on('data', (chunk) => data.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(data)));
        })
        .expect(200);

      expect(downloadRes.headers['content-disposition']).toContain(`filename="${filename}"`);
      expect(downloadRes.body.equals(originalBinaryData)).toBe(true);

      // 7. Enforce One-Time Policy: Second attempt MUST return 410 Gone (TOK-5)
      const reaccessRes = await request(app)
        .get(`/s/${shortCode}`)
        .expect(410);

      expect(reaccessRes.body).toHaveProperty('error', 'Share has already been consumed');
      expect(reaccessRes.body).toHaveProperty('requestId');

      // Verify share is marked consumed in DB
      const updatedShare = await Share.findOne({ shortCode });
      expect(updatedShare.consumedAt).not.toBeNull();
      expect(updatedShare.consumedAt).toBeInstanceOf(Date);
    });
  });

  describe('Scenario 2: End-to-End Secret Paste, Multi-Access, and TTL Expiration', () => {
    it('should complete full lifecycle: paste text -> share -> multiple reads -> TTL expiry', async () => {
      const secretText = [
        '# Secret Environment Configuration',
        'DATABASE_URL=postgres://app_user:s3cr3t_p4ss@db.internal:5432/production_db',
        'API_KEY=dvk_live_89f1a23c45e67b890123456789abcdef',
        'JWT_SECRET=super-secure-production-jwt-signing-key-minimum-256-bit',
      ].join('\n');

      // 1. Ingest text paste via POST /api/files (V0-T09)
      const pasteRes = await request(app)
        .post('/api/files')
        .send({
          type: 'text',
          content: secretText,
        })
        .expect(201);

      expect(pasteRes.body).toHaveProperty('fileId');
      const { fileId } = pasteRes.body;
      fileIdsToCleanup.push(fileId);

      const fileDoc = await File.findById(fileId);
      expect(fileDoc.mimeType).toBe('text/plain');
      expect(fileDoc.originalName).toMatch(/^paste-/);
      storedNamesToCleanup.push(fileDoc.storedName);

      // 2. Create Multi-Access Share without oneTime constraint (V0-T10)
      const shareRes = await request(app)
        .post('/api/shares')
        .send({
          fileId,
          oneTime: false,
          expiresIn: 3600,
        })
        .expect(201);

      expect(shareRes.body.type).toBe('text');
      expect(shareRes.body.oneTime).toBe(false);
      const { shortCode } = shareRes.body;

      // 3. Read secret multiple times — MUST succeed repeatedly with 200 OK
      for (let i = 0; i < 3; i++) {
        const readRes = await request(app)
          .get(`/s/${shortCode}`)
          .expect(200);

        expect(readRes.headers['content-type']).toContain('text/plain');
        const retrievedText = readRes.text || readRes.body.toString('utf8');
        expect(retrievedText).toBe(secretText);
      }

      // 4. Artificially expire the share in the past
      await Share.updateOne(
        { shortCode },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );

      // 5. Subsequent access MUST fail with 410 Gone (TTL policy)
      const expiredRes = await request(app)
        .get(`/s/${shortCode}`)
        .expect(410);

      expect(expiredRes.body).toHaveProperty('error', 'Share has expired');
      expect(expiredRes.body).toHaveProperty('requestId');
    });
  });

  describe('Scenario 3: System Boundaries & Error Handling Contracts (V0-T13)', () => {
    it('should reject oversized file uploads with HTTP 413', async () => {
      const oversizedBuffer = Buffer.alloc(config.maxFileSize + 1024);

      const res = await request(app)
        .post('/api/files')
        .attach('file', oversizedBuffer, 'oversized.bin')
        .expect(413);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/exceeds the limit/i);
      expect(res.body).toHaveProperty('requestId');
    });

    it('should reject oversized text pastes with HTTP 413', async () => {
      const hugeText = 'X'.repeat(config.maxTextSize + 100);

      const res = await request(app)
        .post('/api/files')
        .send({ type: 'text', content: hugeText })
        .expect(413);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toMatch(/exceeds maximum limit/i);
      expect(res.body).toHaveProperty('requestId');
    });

    it('should reject empty text pastes with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/files')
        .send({ type: 'text', content: '   ' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'Text content cannot be empty');
      expect(res.body).toHaveProperty('requestId');
    });

    it('should reject share creation for non-existent fileId with HTTP 404', async () => {
      const randomId = new crypto.randomBytes(12).toString('hex');

      const res = await request(app)
        .post('/api/shares')
        .send({ fileId: randomId })
        .expect(404);

      expect(res.body).toHaveProperty('error', 'File not found');
      expect(res.body).toHaveProperty('requestId');
    });

    it('should reject non-existent or malformed share tokens with HTTP 404', async () => {
      const res = await request(app)
        .get('/s/completely-invalid-short-token')
        .expect(404);

      expect(res.body).toHaveProperty('error', 'Share not found');
      expect(res.body).toHaveProperty('requestId');
    });

    it('should ensure all responses carry X-Request-Id correlation headers (LOG-1)', async () => {
      const res = await request(app).get('/');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
    });
  });

  describe('Scenario 4: Cryptographic Authenticity & Tamper Resistance (ENC-8)', () => {
    it('should fail closed when stored ciphertext is tampered with', async () => {
      const sensitiveData = Buffer.from('uncompromised-secret-data');
      const filename = 'tamper-test.txt';

      const uploadRes = await request(app)
        .post('/api/files')
        .attach('file', sensitiveData, filename)
        .expect(201);

      const { fileId } = uploadRes.body;
      fileIdsToCleanup.push(fileId);

      const fileDoc = await File.findById(fileId);
      storedNamesToCleanup.push(fileDoc.storedName);

      const shareRes = await request(app)
        .post('/api/shares')
        .send({ fileId })
        .expect(201);

      const { shortCode } = shareRes.body;

      // Tamper with physical ciphertext on disk (flip bytes)
      const diskPath = path.join(config.uploadDir, fileDoc.storedName);
      const ciphertext = await fs.promises.readFile(diskPath);
      ciphertext[0] = ciphertext[0] ^ 0xff; // Flip bits
      await fs.promises.writeFile(diskPath, ciphertext);

      // Attempt retrieval: AES-256-GCM authTag verification MUST fail (HTTP 500 fail-closed)
      const tamperedRes = await request(app)
        .get(`/s/${shortCode}`)
        .expect(500);

      expect(tamperedRes.body).toHaveProperty('error');
      expect(tamperedRes.body).toHaveProperty('requestId');
    });
  });
});
