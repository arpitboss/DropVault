const crypto = require('crypto');
const config = require('../config');

const KEK_BYTE_LENGTH = 32; // 256-bit Key Encryption Key
const DEK_BYTE_LENGTH = 32; // 256-bit Data Encryption Key
const WRAP_IV_BYTE_LENGTH = 12; // 96-bit IV for AES-GCM key wrapping
const WRAP_TAG_BYTE_LENGTH = 16; // 128-bit Auth Tag for key wrapping
const ALGORITHM = 'aes-256-gcm';

/**
 * Retrieves and validates the Key Encryption Key (KEK) from environment configuration (ENC-6).
 * Never derived from user credentials (ENC-5).
 * @returns {Buffer} 32-byte KEK buffer
 */
const getKEK = () => {
  const kekHex = config.masterEncryptionKey;

  if (!kekHex || typeof kekHex !== 'string') {
    throw new Error(
      'Master encryption key (MASTER_ENCRYPTION_KEY) is missing. Set a 64-character hex string in .env'
    );
  }

  const kekBuffer = Buffer.from(kekHex, 'hex');

  if (kekBuffer.length !== KEK_BYTE_LENGTH || kekHex.length !== KEK_BYTE_LENGTH * 2) {
    throw new Error(
      `Master encryption key (MASTER_ENCRYPTION_KEY) must be a 64-character hex string (${KEK_BYTE_LENGTH} bytes)`
    );
  }

  return kekBuffer;
};

/**
 * Generates a cryptographically secure, unique Data Encryption Key (DEK) (ENC-2).
 * @returns {Buffer} 32-byte DEK buffer
 */
const generateDEK = () => {
  return crypto.randomBytes(DEK_BYTE_LENGTH);
};

/**
 * Wraps a per-file DEK using the KEK via authenticated AES-256-GCM (ENC-3).
 * Returns a packed hex string containing: [wrapIv (12 bytes) + wrapTag (16 bytes) + encryptedDEK (32 bytes)].
 * @param {Buffer} dek - 32-byte plain DEK
 * @param {Buffer} [kek] - Optional 32-byte KEK override (defaults to environment KEK)
 * @returns {string} Hex-encoded wrapped DEK package
 */
const wrapDEK = (dek, kek = getKEK()) => {
  if (!Buffer.isBuffer(dek) || dek.length !== DEK_BYTE_LENGTH) {
    throw new TypeError(`DEK must be a ${DEK_BYTE_LENGTH}-byte Buffer`);
  }

  if (!Buffer.isBuffer(kek) || kek.length !== KEK_BYTE_LENGTH) {
    throw new TypeError(`KEK must be a ${KEK_BYTE_LENGTH}-byte Buffer`);
  }

  const wrapIv = crypto.randomBytes(WRAP_IV_BYTE_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, kek, wrapIv);

  const encryptedDEK = Buffer.concat([cipher.update(dek), cipher.final()]);
  const wrapTag = cipher.getAuthTag();

  const packed = Buffer.concat([wrapIv, wrapTag, encryptedDEK]);
  return packed.toString('hex');
};

/**
 * Unwraps an encrypted DEK using the KEK via authenticated AES-256-GCM (ENC-3, ENC-8).
 * @param {string} encryptedDEKHex - Hex-encoded wrapped DEK package
 * @param {Buffer} [kek] - Optional 32-byte KEK override (defaults to environment KEK)
 * @returns {Buffer} 32-byte plain DEK buffer
 */
const unwrapDEK = (encryptedDEKHex, kek = getKEK()) => {
  if (!encryptedDEKHex || typeof encryptedDEKHex !== 'string') {
    throw new Error('Encrypted DEK must be a non-empty hex string');
  }

  if (!Buffer.isBuffer(kek) || kek.length !== KEK_BYTE_LENGTH) {
    throw new TypeError(`KEK must be a ${KEK_BYTE_LENGTH}-byte Buffer`);
  }

  const packed = Buffer.from(encryptedDEKHex, 'hex');
  const minLength = WRAP_IV_BYTE_LENGTH + WRAP_TAG_BYTE_LENGTH + DEK_BYTE_LENGTH;

  if (packed.length !== minLength) {
    throw new Error(`Invalid wrapped DEK payload length: expected ${minLength} bytes`);
  }

  const wrapIv = packed.subarray(0, WRAP_IV_BYTE_LENGTH);
  const wrapTag = packed.subarray(WRAP_IV_BYTE_LENGTH, WRAP_IV_BYTE_LENGTH + WRAP_TAG_BYTE_LENGTH);
  const cipherText = packed.subarray(WRAP_IV_BYTE_LENGTH + WRAP_TAG_BYTE_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, kek, wrapIv);
  decipher.setAuthTag(wrapTag);

  return Buffer.concat([decipher.update(cipherText), decipher.final()]);
};

module.exports = {
  getKEK,
  generateDEK,
  wrapDEK,
  unwrapDEK,
  KEK_BYTE_LENGTH,
  DEK_BYTE_LENGTH,
  WRAP_IV_BYTE_LENGTH,
  WRAP_TAG_BYTE_LENGTH,
  ALGORITHM,
};
