const Share = require('../models/Share');
const { isTokenValidFormat } = require('../utils/tokenGenerator');
const { getStorageProvider } = require('../storage');
const { decrypt } = require('../crypto/encryption');

/**
 * Accesses and decrypts a shared file/secret payload (V0-T11).
 * Validates token validity, expiration, and one-time consumption policies.
 *
 * @param {string} shortCode - Ephemeral share token
 * @returns {Promise<{ buffer: Buffer, originalName: string, mimeType: string, size: number }>}
 */
const accessShare = async (shortCode) => {
  if (!shortCode || !isTokenValidFormat(shortCode)) {
    const error = new Error('Share not found');
    error.status = 404;
    throw error;
  }

  const share = await Share.findOne({ shortCode }).populate('fileId');

  if (!share || !share.fileId) {
    const error = new Error('Share not found');
    error.status = 404;
    throw error;
  }

  const now = new Date();

  // 1. Check expiration (TTL)
  if (share.expiresAt && now > share.expiresAt) {
    const error = new Error('Share has expired');
    error.status = 410;
    throw error;
  }

  // 2. Check one-time access consumption
  if (share.oneTime && share.consumedAt) {
    const error = new Error('Share has already been consumed');
    error.status = 410;
    throw error;
  }

  const file = share.fileId;

  // 3. Retrieve encrypted ciphertext from StorageProvider (STO-1..4)
  const storageProvider = getStorageProvider();
  const encryptedBuffer = await storageProvider.retrieve(file.storedName);

  // 4. Decrypt payload using per-file DEK envelope and AES-256-GCM (ENC-1..8)
  const plainBuffer = await decrypt(encryptedBuffer, file.encryptionMetadata);

  // 5. Enforce one-time consumption (non-atomic in V0, atomic in V1 via Redis)
  if (share.oneTime) {
    share.consumedAt = now;
    await share.save();
  }

  return {
    buffer: plainBuffer,
    originalName: file.originalName,
    mimeType: file.mimeType || 'application/octet-stream',
    size: plainBuffer.length,
  };
};

module.exports = {
  accessShare,
};
