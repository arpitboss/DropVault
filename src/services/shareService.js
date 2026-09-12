const mongoose = require('mongoose');
const Share = require('../models/Share');
const File = require('../models/File');
const { generateShareToken } = require('../utils/tokenGenerator');
const AppError = require('../utils/AppError');

/**
 * Creates an ephemeral share descriptor for an uploaded file or secret (V0-T10).
 *
 * @param {Object} params
 * @param {string} params.fileId - ID of the uploaded file to share
 * @param {boolean} [params.oneTime=false] - Whether access expires after one download
 * @param {number} [params.expiresIn] - Expiration duration in seconds
 * @param {string} [params.type] - Share type override ('file' | 'text')
 * @returns {Promise<Object>} Persisted share metadata and access URL
 */
const createShare = async ({ fileId, oneTime = false, expiresIn, type }) => {
  if (!fileId) {
    throw AppError.badRequest('fileId is required');
  }

  if (!mongoose.Types.ObjectId.isValid(fileId)) {
    throw AppError.notFound('File not found');
  }

  const fileDoc = await File.findById(fileId);
  if (!fileDoc) {
    throw AppError.notFound('File not found');
  }

  // Determine share type (infer from file if not explicitly supplied)
  let resolvedType = type;
  if (!resolvedType) {
    resolvedType =
      fileDoc.mimeType === 'text/plain' && fileDoc.originalName.startsWith('paste-')
        ? 'text'
        : 'file';
  }

  // Compute expiration date from expiresIn seconds if supplied
  let expiresAt = null;
  if (expiresIn !== undefined && expiresIn !== null) {
    const seconds = Number(expiresIn);
    if (isNaN(seconds) || seconds <= 0) {
      throw AppError.badRequest('expiresIn must be a positive number of seconds');
    }
    expiresAt = new Date(Date.now() + seconds * 1000);
  }

  // Generate cryptographically secure 256-bit URL-safe token (TOK-1..5)
  const shortCode = generateShareToken();

  const shareDoc = await Share.create({
    fileId: fileDoc._id,
    type: resolvedType,
    shortCode,
    oneTime: Boolean(oneTime),
    expiresAt,
  });

  return {
    shareId: shareDoc._id.toString(),
    shortCode: shareDoc.shortCode,
    shareUrl: `/s/${shareDoc.shortCode}`,
    fileId: shareDoc.fileId.toString(),
    type: shareDoc.type,
    oneTime: shareDoc.oneTime,
    expiresAt: shareDoc.expiresAt,
    createdAt: shareDoc.createdAt,
  };
};

module.exports = {
  createShare,
};
