const crypto = require('crypto');
const { encrypt, decrypt } = require('../src/crypto/encryption');
const {
  getKEK,
  generateDEK,
  wrapDEK,
  unwrapDEK,
  KEK_BYTE_LENGTH,
  DEK_BYTE_LENGTH,
} = require('../src/crypto/keyManager');

describe('Encryption Service & Key Management (V0-T04)', () => {
  describe('Key Manager (keyManager.js)', () => {
    it('should retrieve a valid 32-byte KEK from config (ENC-6)', () => {
      const kek = getKEK();
      expect(Buffer.isBuffer(kek)).toBe(true);
      expect(kek.length).toBe(KEK_BYTE_LENGTH);
    });

    it('should generate a unique 32-byte DEK on each call (ENC-2)', () => {
      const dek1 = generateDEK();
      const dek2 = generateDEK();
      expect(Buffer.isBuffer(dek1)).toBe(true);
      expect(dek1.length).toBe(DEK_BYTE_LENGTH);
      expect(dek2.length).toBe(DEK_BYTE_LENGTH);
      expect(dek1.equals(dek2)).toBe(false);
    });

    it('should wrap and unwrap a DEK correctly using KEK (ENC-3)', () => {
      const dek = generateDEK();
      const wrapped = wrapDEK(dek);
      expect(typeof wrapped).toBe('string');

      const unwrapped = unwrapDEK(wrapped);
      expect(Buffer.isBuffer(unwrapped)).toBe(true);
      expect(unwrapped.equals(dek)).toBe(true);
    });

    it('should fail unwrapping when using the wrong KEK', () => {
      const dek = generateDEK();
      const wrapped = wrapDEK(dek);

      const wrongKek = crypto.randomBytes(KEK_BYTE_LENGTH);
      expect(() => unwrapDEK(wrapped, wrongKek)).toThrow();
    });

    it('should fail unwrapping when wrapped payload is tampered with', () => {
      const dek = generateDEK();
      const wrapped = wrapDEK(dek);

      // Flip characters in the hex string
      const tampered = wrapped.slice(0, -4) + (wrapped.slice(-4) === '0000' ? 'ffff' : '0000');
      expect(() => unwrapDEK(tampered)).toThrow();
    });
  });

  describe('Encryption & Decryption (encryption.js)', () => {
    it('should encrypt and decrypt a text buffer round-trip (ENC-1..8)', async () => {
      const plainText = Buffer.from('Confidential Developer Secret Content: 12345!@#$%^&*()');
      const { encryptedBuffer, encryptionMetadata } = await encrypt(plainText);

      // Verify encrypted buffer is different from plaintext
      expect(Buffer.isBuffer(encryptedBuffer)).toBe(true);
      expect(encryptedBuffer.equals(plainText)).toBe(false);

      // Verify metadata shape
      expect(encryptionMetadata).toHaveProperty('iv');
      expect(encryptionMetadata).toHaveProperty('authTag');
      expect(encryptionMetadata).toHaveProperty('encryptedDEK');
      expect(typeof encryptionMetadata.iv).toBe('string');
      expect(typeof encryptionMetadata.authTag).toBe('string');
      expect(typeof encryptionMetadata.encryptedDEK).toBe('string');

      // Decrypt and verify exact match
      const decrypted = await decrypt(encryptedBuffer, encryptionMetadata);
      expect(decrypted.equals(plainText)).toBe(true);
      expect(decrypted.toString('utf8')).toBe(plainText.toString('utf8'));
    });

    it('should encrypt and decrypt arbitrary binary buffers including null bytes', async () => {
      const binaryData = crypto.randomBytes(64 * 1024); // 64 KB random binary
      const { encryptedBuffer, encryptionMetadata } = await encrypt(binaryData);

      const decrypted = await decrypt(encryptedBuffer, encryptionMetadata);
      expect(decrypted.equals(binaryData)).toBe(true);
    });

    it('should produce unique IV and unique DEK for every call (ENC-2, ENC-7)', async () => {
      const content = Buffer.from('Identical plaintext payload');
      const ivSet = new Set();
      const dekSet = new Set();

      for (let i = 0; i < 50; i++) {
        const { encryptionMetadata } = await encrypt(content);
        ivSet.add(encryptionMetadata.iv);
        dekSet.add(encryptionMetadata.encryptedDEK);
      }

      // 50 unique IVs and 50 unique wrapped DEKs
      expect(ivSet.size).toBe(50);
      expect(dekSet.size).toBe(50);
    });

    it('should throw error when ciphertext is tampered with (ENC-8 auth tag failure)', async () => {
      const plain = Buffer.from('Sensitive payload to tamper with');
      const { encryptedBuffer, encryptionMetadata } = await encrypt(plain);

      // Corrupt a single byte in ciphertext
      const tamperedBuffer = Buffer.from(encryptedBuffer);
      tamperedBuffer[0] ^= 0x01;

      await expect(decrypt(tamperedBuffer, encryptionMetadata)).rejects.toThrow(
        /authentication tag mismatch|tampered data/i
      );
    });

    it('should throw error when authTag is tampered with (ENC-8)', async () => {
      const plain = Buffer.from('Sensitive payload');
      const { encryptedBuffer, encryptionMetadata } = await encrypt(plain);

      const tamperedTag =
        encryptionMetadata.authTag.slice(0, -2) +
        (encryptionMetadata.authTag.slice(-2) === 'aa' ? 'bb' : 'aa');

      const corruptedMetadata = {
        ...encryptionMetadata,
        authTag: tamperedTag,
      };

      await expect(decrypt(encryptedBuffer, corruptedMetadata)).rejects.toThrow(
        /authentication tag mismatch|tampered data/i
      );
    });

    it('should throw error when IV is tampered with (ENC-7)', async () => {
      const plain = Buffer.from('Sensitive payload');
      const { encryptedBuffer, encryptionMetadata } = await encrypt(plain);

      const tamperedIv =
        encryptionMetadata.iv.slice(0, -2) +
        (encryptionMetadata.iv.slice(-2) === '11' ? '22' : '11');

      const corruptedMetadata = {
        ...encryptionMetadata,
        iv: tamperedIv,
      };

      await expect(decrypt(encryptedBuffer, corruptedMetadata)).rejects.toThrow(
        /authentication tag mismatch|tampered data/i
      );
    });

    it('should throw error when decryption is attempted with wrong KEK', async () => {
      const plain = Buffer.from('Protected by original KEK');
      const { encryptedBuffer, encryptionMetadata } = await encrypt(plain);

      const wrongKek = crypto.randomBytes(KEK_BYTE_LENGTH);

      await expect(
        decrypt(encryptedBuffer, encryptionMetadata, { kek: wrongKek })
      ).rejects.toThrow();
    });

    it('should reject invalid input types with TypeError', async () => {
      await expect(encrypt('string-instead-of-buffer')).rejects.toThrow(TypeError);
      await expect(decrypt('string-instead-of-buffer', {})).rejects.toThrow(TypeError);
      await expect(decrypt(Buffer.from('data'), null)).rejects.toThrow('encryptionMetadata');
    });
  });
});
