const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Share = require('../models/Share');
const File = require('../models/File');
const { generateShareToken } = require('../utils/tokenGenerator');
const { isValidIpOrCidr } = require('../utils/ipValidator');
const { isRedisConnected } = require('../config/redis');
const redisAccessService = require('./redisAccessService');
const AppError = require('../utils/AppError');

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Creates an ephemeral share descriptor for an uploaded file or secret (V0-T10, V1-T08).
 *
 * Supported options:
 * - oneTime: boolean — access expires after first download
 * - expiresIn: number — duration in seconds until expiration
 * - type: 'file' | 'text' — share type override
 * - password: string — optional password protection (hashed with bcrypt, rounds=12)
 * - ipAllow: string[] — optional IP/CIDR whitelist
 * - ipDeny: string[] — optional IP/CIDR blacklist
 * - maxDownloads: number — maximum number of allowed downloads (>= 1)
 * - ownerId: string | ObjectId — optional user ownership (dual-mode)
 *
 * @param {Object} params
 * @returns {Promise<Object>} Persisted share metadata and access URL (never exposes passwordHash)
 */
const createShare = async ({
  fileId,
  oneTime = false,
  expiresIn,
  type,
  password,
  ipAllow,
  ipDeny,
  maxDownloads,
  ownerId,
}) => {
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
  } else if (!['file', 'text'].includes(resolvedType)) {
    throw AppError.badRequest('Invalid share type: must be "file" or "text"');
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

  // Password policy validation & hashing (V1-T08)
  let passwordHash = null;
  if (password !== undefined && password !== null) {
    if (typeof password !== 'string' || password.trim().length === 0) {
      throw AppError.badRequest('Password must be a non-empty string');
    }
    if (password.length < 4) {
      throw AppError.badRequest('Password must be at least 4 characters long');
    }
    passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  // ipAllow validation (V1-T08)
  let normalizedIpAllow = [];
  if (ipAllow !== undefined && ipAllow !== null) {
    if (!Array.isArray(ipAllow)) {
      throw AppError.badRequest('ipAllow must be an array of IP addresses or CIDR ranges');
    }
    for (const entry of ipAllow) {
      if (!isValidIpOrCidr(entry)) {
        throw AppError.badRequest(`Invalid IP address or CIDR range in ipAllow: ${entry}`);
      }
    }
    normalizedIpAllow = ipAllow.map((entry) => entry.trim());
  }

  // ipDeny validation (V1-T08)
  let normalizedIpDeny = [];
  if (ipDeny !== undefined && ipDeny !== null) {
    if (!Array.isArray(ipDeny)) {
      throw AppError.badRequest('ipDeny must be an array of IP addresses or CIDR ranges');
    }
    for (const entry of ipDeny) {
      if (!isValidIpOrCidr(entry)) {
        throw AppError.badRequest(`Invalid IP address or CIDR range in ipDeny: ${entry}`);
      }
    }
    normalizedIpDeny = ipDeny.map((entry) => entry.trim());
  }

  // maxDownloads validation (V1-T08)
  let resolvedMaxDownloads = null;
  if (maxDownloads !== undefined && maxDownloads !== null) {
    const max = Number(maxDownloads);
    if (isNaN(max) || !Number.isInteger(max) || max < 1) {
      throw AppError.badRequest('maxDownloads must be a positive integer greater than or equal to 1');
    }
    if (Boolean(oneTime) && max > 1) {
      throw AppError.badRequest('Cannot specify both oneTime and maxDownloads greater than 1');
    }
    resolvedMaxDownloads = max;
  }

  // ownerId validation (dual-mode architecture)
  let resolvedOwnerId = null;
  if (ownerId !== undefined && ownerId !== null) {
    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
      throw AppError.badRequest('Invalid ownerId');
    }
    resolvedOwnerId = new mongoose.Types.ObjectId(ownerId);
  }

  // Generate cryptographically secure 256-bit URL-safe token (TOK-1..5)
  const shortCode = generateShareToken();

  const shareDoc = await Share.create({
    fileId: fileDoc._id,
    type: resolvedType,
    shortCode,
    oneTime: Boolean(oneTime),
    expiresAt,
    passwordHash,
    ipAllow: normalizedIpAllow,
    ipDeny: normalizedIpDeny,
    maxDownloads: resolvedMaxDownloads,
    ownerId: resolvedOwnerId,
  });

  // Initialize live Redis access state for atomic enforcement (V1-T09)
  if (isRedisConnected()) {
    await redisAccessService.initShareState({
      shareId: shareDoc._id.toString(),
      oneTime: shareDoc.oneTime,
      maxDownloads: shareDoc.maxDownloads,
      expiresAt: shareDoc.expiresAt,
    });
  }

  return {
    shareId: shareDoc._id.toString(),
    shortCode: shareDoc.shortCode,
    shareUrl: `/s/${shareDoc.shortCode}`,
    fileId: shareDoc.fileId.toString(),
    type: shareDoc.type,
    oneTime: shareDoc.oneTime,
    expiresAt: shareDoc.expiresAt,
    createdAt: shareDoc.createdAt,
    hasPassword: Boolean(shareDoc.passwordHash),
    ipAllow: shareDoc.ipAllow,
    ipDeny: shareDoc.ipDeny,
    maxDownloads: shareDoc.maxDownloads,
    downloadCount: shareDoc.downloadCount,
    ownerId: shareDoc.ownerId ? shareDoc.ownerId.toString() : null,
  };
};

module.exports = {
  createShare,
};
