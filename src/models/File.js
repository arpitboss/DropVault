const mongoose = require('mongoose');

/**
 * Nested schema for file encryption metadata (ENC-4).
 * Stores the IV, auth tag, and KEK-wrapped DEK.
 */
const encryptionMetadataSchema = new mongoose.Schema(
  {
    iv: {
      type: String,
      required: [true, 'iv is required in encryptionMetadata'],
      trim: true,
    },
    authTag: {
      type: String,
      required: [true, 'authTag is required in encryptionMetadata'],
      trim: true,
    },
    encryptedDEK: {
      type: String,
      required: [true, 'encryptedDEK is required in encryptionMetadata'],
      trim: true,
    },
  },
  { _id: false }
);

/**
 * Mongoose Schema for the `files` collection (V0-T05).
 * Holds file metadata and encryption envelope; physical content resides in StorageProvider.
 */
const fileSchema = new mongoose.Schema(
  {
    originalName: {
      type: String,
      required: [true, 'originalName is required'],
      trim: true,
    },
    storedName: {
      type: String,
      required: [true, 'storedName is required'],
      unique: true,
      trim: true,
      index: true,
    },
    size: {
      type: Number,
      required: [true, 'size is required'],
      min: [0, 'size cannot be negative'],
    },
    mimeType: {
      type: String,
      required: [true, 'mimeType is required'],
      trim: true,
    },
    storagePath: {
      type: String,
      required: [true, 'storagePath is required'],
      trim: true,
    },
    encryptionMetadata: {
      type: encryptionMetadataSchema,
      required: [true, 'encryptionMetadata is required'],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    versionKey: false,
  }
);

const File = mongoose.models.File || mongoose.model('File', fileSchema);

module.exports = File;
