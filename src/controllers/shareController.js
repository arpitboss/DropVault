const shareService = require('../services/shareService');
const accessService = require('../services/accessService');

/**
 * Controller handling share creation requests (POST /api/shares).
 */
const createShare = async (req, res, next) => {
  try {
    const { fileId, oneTime, expiresIn, type } = req.body || {};

    if (!fileId) {
      throw require('../utils/AppError').badRequest('fileId is required');
    }

    const result = await shareService.createShare({
      fileId,
      oneTime,
      expiresIn,
      type,
    });

    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
};

/**
 * Controller handling share retrieval and file downloads (GET /s/:shortCode).
 */
const accessShare = async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    const fileData = await accessService.accessShare(shortCode);

    res.attachment(fileData.originalName);
    res.setHeader('Content-Type', fileData.mimeType);
    res.setHeader('Content-Length', fileData.size);

    return res.send(fileData.buffer);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createShare,
  accessShare,
};

