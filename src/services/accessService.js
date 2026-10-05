const bcrypt = require('bcryptjs');
const Share = require('../models/Share');
const { isTokenValidFormat } = require('../utils/tokenGenerator');
const { isIpInList } = require('../utils/ipValidator');
const { getStorageProvider } = require('../storage');
const { decrypt } = require('../crypto/encryption');
const { isRedisConnected } = require('../config/redis');
const redisAccessService = require('./redisAccessService');
const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * Accesses and decrypts a shared file/secret payload with full V1 policy enforcement (V0-T11, V1-T10).
 *
 * Full access control flow (§21 of specification):
 * 1. Validate shortCode format & find share in MongoDB
 * 2. Check revocation status (`revokedAt`) -> 410 Gone
 * 3. Check expiration timestamp (`expiresAt`) -> 410 Gone
 * 4. Check client IP against `ipDeny` and `ipAllow` CIDR rules -> 403 Forbidden
 * 5. Check password protection via timing-safe bcrypt compare -> 403 Forbidden
 * 6. Atomic one-time or max-downloads consumption via Redis (CON-1..5) -> 410 Gone if exhausted
 * 7. Retrieve encrypted payload from storage provider and decrypt via AES-256-GCM
 *
 * @param {Object|string} params - Parameters object or direct shortCode string
 * @param {string} [params.shortCode] - Share shortCode token
 * @param {string} [params.clientIp] - Client IP address
 * @param {string} [params.password] - Optional password for protected shares
 * @returns {Promise<{ buffer: Buffer, originalName: string, mimeType: string, size: number }>}
 */
const accessShare = async (params) => {
  let shortCode;
  let clientIp = null;
  let password = null;

  if (typeof params === 'string') {
    shortCode = params;
  } else if (params && typeof params === 'object') {
    ({ shortCode, clientIp, password } = params);
  }

  // 1. Validate shortCode format and lookup Share + File
  if (!shortCode || !isTokenValidFormat(shortCode)) {
    throw AppError.notFound('Share not found');
  }

  const share = await Share.findOne({ shortCode }).populate('fileId');

  if (!share || !share.fileId) {
    throw AppError.notFound('Share not found');
  }

  const now = new Date();

  // 2. Check revocation status
  if (share.revokedAt) {
    throw AppError.gone('Share has been revoked');
  }

  // 3. Check expiration (TTL)
  if (share.expiresAt && now > share.expiresAt) {
    throw AppError.gone('Share has expired');
  }

  // 4. Check IP allow / deny policies
  if (clientIp) {
    if (share.ipDeny && share.ipDeny.length > 0 && isIpInList(clientIp, share.ipDeny)) {
      throw AppError.forbidden('Access denied by IP policy');
    }
    if (share.ipAllow && share.ipAllow.length > 0 && !isIpInList(clientIp, share.ipAllow)) {
      throw AppError.forbidden('Access denied by IP policy');
    }
  }

  // 5. Check password protection
  if (share.passwordHash) {
    if (!password || typeof password !== 'string') {
      throw AppError.forbidden('Password required');
    }
    const isMatch = await bcrypt.compare(password, share.passwordHash);
    if (!isMatch) {
      throw AppError.forbidden('Invalid password');
    }
  }

  // 6. Enforce consumption policies (Redis atomic or fallback)
  if (share.oneTime) {
    if (isRedisConnected()) {
      const consumed = await redisAccessService.consumeOneTime(share._id.toString());
      if (!consumed) {
        throw AppError.gone('Share has already been consumed');
      }
    } else {
      if (config.nodeEnv !== 'test') {
        throw AppError.serviceUnavailable(
          'Access control service is temporarily unavailable (Redis unavailable)'
        );
      }
      if (share.consumedAt) {
        throw AppError.gone('Share has already been consumed');
      }
    }

    share.consumedAt = now;
    await share.save();
  }

  if (share.maxDownloads) {
    if (isRedisConnected()) {
      const result = await redisAccessService.incrementDownload(
        share._id.toString(),
        share.maxDownloads,
        share.expiresAt
      );
      if (!result.allowed) {
        throw AppError.gone('Download limit has been reached for this share');
      }
      share.downloadCount = result.currentCount;
      await share.save();
    } else {
      if (config.nodeEnv !== 'test') {
        throw AppError.serviceUnavailable(
          'Access control service is temporarily unavailable (Redis unavailable)'
        );
      }
      if (share.downloadCount >= share.maxDownloads) {
        throw AppError.gone('Download limit has been reached for this share');
      }
      share.downloadCount = (share.downloadCount || 0) + 1;
      await share.save();
    }
  }

  const file = share.fileId;

  // 7. Retrieve encrypted ciphertext from StorageProvider (STO-1..4)
  const storageProvider = getStorageProvider();
  const encryptedBuffer = await storageProvider.retrieve(file.storedName);

  // 8. Decrypt payload using per-file DEK envelope and AES-256-GCM (ENC-1..8)
  const plainBuffer = await decrypt(encryptedBuffer, file.encryptionMetadata);

  return {
    buffer: plainBuffer,
    originalName: file.originalName,
    mimeType: file.mimeType || 'application/octet-stream',
    size: plainBuffer.length,
  };
};

/**
 * Validates a share password without consuming the share or downloading the file.
 * Used by UI portal and CLI clients (V1-T10).
 *
 * @param {Object} params
 * @param {string} params.shortCode
 * @param {string} [params.clientIp]
 * @param {string} params.password
 * @returns {Promise<{ valid: boolean, requiresPassword?: boolean, verified?: boolean }>}
 */
const verifyPassword = async ({ shortCode, clientIp = null, password }) => {
  if (!shortCode || !isTokenValidFormat(shortCode)) {
    throw AppError.notFound('Share not found');
  }

  const share = await Share.findOne({ shortCode });
  if (!share) {
    throw AppError.notFound('Share not found');
  }

  if (share.revokedAt) {
    throw AppError.gone('Share has been revoked');
  }

  if (share.expiresAt && new Date() > share.expiresAt) {
    throw AppError.gone('Share has expired');
  }

  if (clientIp) {
    if (share.ipDeny && share.ipDeny.length > 0 && isIpInList(clientIp, share.ipDeny)) {
      throw AppError.forbidden('Access denied by IP policy');
    }
    if (share.ipAllow && share.ipAllow.length > 0 && !isIpInList(clientIp, share.ipAllow)) {
      throw AppError.forbidden('Access denied by IP policy');
    }
  }

  if (!share.passwordHash) {
    return { valid: true, requiresPassword: false };
  }

  if (!password || typeof password !== 'string') {
    throw AppError.badRequest('Password is required');
  }

  const isMatch = await bcrypt.compare(password, share.passwordHash);
  if (!isMatch) {
    throw AppError.forbidden('Invalid password');
  }

  return { valid: true, verified: true };
};

module.exports = {
  accessShare,
  verifyPassword,
};
