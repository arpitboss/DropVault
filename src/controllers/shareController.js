const shareService = require('../services/shareService');

/**
 * Controller handling share creation requests (POST /api/shares).
 */
const createShare = async (req, res, next) => {
  try {
    const { fileId, oneTime, expiresIn, type } = req.body || {};

    if (!fileId) {
      return res.status(400).json({
        error: 'fileId is required',
      });
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

module.exports = {
  createShare,
};
