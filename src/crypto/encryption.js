const crypto = require('crypto');
const {
  generateDEK,
  wrapDEK,
  unwrapDEK,
  ALGORITHM,
} = require('./keyManager');

const FILE_IV_BYTE_LENGTH = 12; // 96-bit IV standard for AES-256-GCM (ENC-7)
const FILE_TAG_BYTE_LENGTH = 16; // 128-bit authentication tag (ENC-8)

/**
 * Encrypts a plaintext buffer using AES-256-GCM with a unique per-file DEK and KEK wrapping (ENC-1..8).
 * @param {Buffer} plainBuffer - Plaintext file content
 * @param {object} [options={}]
 * @param {Buffer} [options.kek] - Optional master KEK override
 * @returns {Promise<{ encryptedBuffer: Buffer, encryptionMetadata: { iv: string, authTag: string, encryptedDEK: string } }>}
 */
const encrypt = async (plainBuffer, options = {}) => {
  if (!Buffer.isBuffer(plainBuffer)) {
    throw new TypeError('encrypt() expects plainBuffer to be a Buffer');
  }

  // ENC-2: Unique Data Encryption Key per file
  const dek = generateDEK();

  // ENC-7: Unique IV/nonce per encryption operation
  const iv = crypto.randomBytes(FILE_IV_BYTE_LENGTH);

  // ENC-1: AES-256-GCM authenticated encryption
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const encryptedBuffer = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);

  // ENC-8: 16-byte authentication tag
  const authTag = cipher.getAuthTag();

  // ENC-3: DEK wrapped using master KEK
  const encryptedDEK = wrapDEK(dek, options.kek);

  return {
    encryptedBuffer,
    encryptionMetadata: {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encryptedDEK,
    },
  };
};

/**
 * Decrypts an encrypted buffer using AES-256-GCM by unwrapping the DEK and validating the auth tag (ENC-1..8).
 * @param {Buffer} encryptedBuffer - Encrypted ciphertext buffer
 * @param {object} encryptionMetadata
 * @param {string} encryptionMetadata.iv - Hex-encoded 12-byte IV
 * @param {string} encryptionMetadata.authTag - Hex-encoded 16-byte auth tag
 * @param {string} encryptionMetadata.encryptedDEK - Hex-encoded wrapped DEK package
 * @param {object} [options={}]
 * @param {Buffer} [options.kek] - Optional master KEK override
 * @returns {Promise<Buffer>} Original plaintext buffer
 */
const decrypt = async (encryptedBuffer, encryptionMetadata, options = {}) => {
  if (!Buffer.isBuffer(encryptedBuffer)) {
    throw new TypeError('decrypt() expects encryptedBuffer to be a Buffer');
  }

  if (!encryptionMetadata || typeof encryptionMetadata !== 'object') {
    throw new Error('decrypt() expects encryptionMetadata object');
  }

  const { iv, authTag, encryptedDEK } = encryptionMetadata;

  if (!iv || typeof iv !== 'string') {
    throw new Error('Missing or invalid iv in encryptionMetadata');
  }

  if (!authTag || typeof authTag !== 'string') {
    throw new Error('Missing or invalid authTag in encryptionMetadata');
  }

  if (!encryptedDEK || typeof encryptedDEK !== 'string') {
    throw new Error('Missing or invalid encryptedDEK in encryptionMetadata');
  }

  const ivBuffer = Buffer.from(iv, 'hex');
  const authTagBuffer = Buffer.from(authTag, 'hex');

  if (ivBuffer.length !== FILE_IV_BYTE_LENGTH) {
    throw new Error(`Invalid IV length: expected ${FILE_IV_BYTE_LENGTH} bytes`);
  }

  if (authTagBuffer.length !== FILE_TAG_BYTE_LENGTH) {
    throw new Error(`Invalid authTag length: expected ${FILE_TAG_BYTE_LENGTH} bytes`);
  }

  // ENC-3: Unwrap DEK using KEK
  const dek = unwrapDEK(encryptedDEK, options.kek);

  // ENC-1 & ENC-8: AES-256-GCM decryption with auth tag verification
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  try {
    return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
  } catch (error) {
    throw new Error(`Decryption failed: authentication tag mismatch or tampered data (${error.message})`);
  }
};

module.exports = {
  encrypt,
  decrypt,
  FILE_IV_BYTE_LENGTH,
  FILE_TAG_BYTE_LENGTH,
};
