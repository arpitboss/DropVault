const fs = require('fs');
const config = require('../config');
const { encrypt } = require('../crypto/encryption');
const { getStorageProvider } = require('../storage');
const File = require('../models/File');

/**
 * Processes an uploaded file:
 * 1. Reads the temporary file into memory.
 * 2. Immediately unlinks the temporary file to prevent lingering plaintext data on disk.
 * 3. Encrypts the buffer with AES-256-GCM using a per-file DEK wrapped by KEK.
 * 4. Stores the encrypted buffer using the StorageProvider (server-side UUID filename).
 * 5. Persists metadata and encryption envelope in MongoDB.
 *
 * @param {Object} uploadedFile - Multer file object
 * @returns {Promise<Object>} Sanitized file metadata descriptor
 */
const processFileUpload = async (uploadedFile) => {
  if (!uploadedFile || !uploadedFile.path) {
    throw new Error('Invalid file upload payload');
  }

  let plainBuffer;
  try {
    plainBuffer = await fs.promises.readFile(uploadedFile.path);
  } finally {
    // Guarantees temp file cleanup regardless of subsequent execution outcomes
    await fs.promises.unlink(uploadedFile.path).catch(() => {});
  }

  // Encrypt file payload with unique DEK & AES-256-GCM (ENC-1, ENC-2, ENC-3)
  const { encryptedBuffer, encryptionMetadata } = await encrypt(plainBuffer);

  // Store encrypted bytes via StorageProvider (STO-1, UPL-2, UPL-3, UPL-4)
  const storageProvider = getStorageProvider();
  const { storedName, storagePath } = await storageProvider.save(encryptedBuffer, {
    originalName: uploadedFile.originalname,
    mimeType: uploadedFile.mimetype,
  });

  let fileDoc;
  try {
    fileDoc = await File.create({
      originalName: uploadedFile.originalname,
      storedName,
      size: uploadedFile.size,
      mimeType: uploadedFile.mimetype || 'application/octet-stream',
      storagePath,
      encryptionMetadata,
    });
  } catch (err) {
    // Rollback storage if database persistence fails
    await storageProvider.delete(storedName).catch(() => {});
    throw err;
  }

  return {
    fileId: fileDoc._id.toString(),
    originalName: fileDoc.originalName,
    size: fileDoc.size,
    createdAt: fileDoc.createdAt,
  };
};

/**
 * Processes a text/paste secret payload (V0-T09):
 * 1. Validates text content and enforces size limit (1MB default).
 * 2. Converts UTF-8 string to a buffer.
 * 3. Encrypts with AES-256-GCM and unique DEK.
 * 4. Persists encrypted buffer to StorageProvider.
 * 5. Creates File document in MongoDB with mimeType "text/plain" and name "paste-<timestamp>".
 *
 * @param {string} content - Raw text snippet to encrypt and store
 * @returns {Promise<Object>} Sanitized file metadata descriptor
 */
const processTextPaste = async (content) => {
  if (typeof content !== 'string' || content.trim().length === 0) {
    const error = new Error('Text content cannot be empty');
    error.status = 400;
    throw error;
  }

  const plainBuffer = Buffer.from(content, 'utf8');

  if (plainBuffer.length > config.maxTextSize) {
    const error = new Error(
      `Text content exceeds maximum limit of ${config.maxTextSize} bytes`
    );
    error.status = 413;
    throw error;
  }

  const originalName = `paste-${Date.now()}`;
  const mimeType = 'text/plain';

  // Encrypt text payload with unique DEK & AES-256-GCM
  const { encryptedBuffer, encryptionMetadata } = await encrypt(plainBuffer);

  // Store encrypted bytes via StorageProvider
  const storageProvider = getStorageProvider();
  const { storedName, storagePath } = await storageProvider.save(encryptedBuffer, {
    originalName,
    mimeType,
  });

  let fileDoc;
  try {
    fileDoc = await File.create({
      originalName,
      storedName,
      size: plainBuffer.length,
      mimeType,
      storagePath,
      encryptionMetadata,
    });
  } catch (err) {
    // Rollback storage if database persistence fails
    await storageProvider.delete(storedName).catch(() => {});
    throw err;
  }

  return {
    fileId: fileDoc._id.toString(),
    originalName: fileDoc.originalName,
    size: fileDoc.size,
    createdAt: fileDoc.createdAt,
  };
};

module.exports = {
  processFileUpload,
  processTextPaste,
};

