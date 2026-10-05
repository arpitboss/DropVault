const shareService = require('../services/shareService');
const accessService = require('../services/accessService');

/**
 * Controller handling share creation requests (POST /api/shares).
 */
const createShare = async (req, res, next) => {
  try {
    const {
      fileId,
      oneTime,
      expiresIn,
      type,
      password,
      ipAllow,
      ipDeny,
      maxDownloads,
    } = req.body || {};

    if (!fileId) {
      throw require('../utils/AppError').badRequest('fileId is required');
    }

    // Support dual-mode: extract ownerId if user is authenticated via JWT (V1-T06/T08)
    const ownerId = req.user ? (req.user.userId || req.user._id || req.user.id) : null;

    const result = await shareService.createShare({
      fileId,
      oneTime,
      expiresIn,
      type,
      password,
      ipAllow,
      ipDeny,
      maxDownloads,
      ownerId,
    });

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * Helper to extract client IP, honoring X-Forwarded-For header when present.
 */
const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
};

/**
 * Controller handling share retrieval and file downloads (GET /s/:shortCode, POST /s/:shortCode).
 */
const accessShare = async (req, res, next) => {
  try {
    const { shortCode } = req.params;
    const clientIp = getClientIp(req);
    const password =
      req.headers['x-share-password'] ||
      req.query.password ||
      (req.body ? req.body.password : undefined);

    const fileData = await accessService.accessShare({
      shortCode,
      clientIp,
      password,
    });

    res.attachment(fileData.originalName);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Length', fileData.size);

    return res.send(fileData.buffer);
  } catch (error) {
    return next(error);
  }
};

/**
 * Controller handling share password verification without download (POST /s/:shortCode/verify).
 */
const verifySharePassword = async (req, res, next) => {
  try {
    const { shortCode } = req.params;
    const clientIp = getClientIp(req);
    const { password } = req.body || {};

    const result = await accessService.verifyPassword({
      shortCode,
      clientIp,
      password,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createShare,
  accessShare,
  verifySharePassword,
};

