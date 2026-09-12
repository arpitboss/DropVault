const fileService = require('../services/fileService');
const AppError = require('../utils/AppError');

/**
 * Controller handling file upload and text paste requests (POST /api/files).
 */
const uploadFile = async (req, res, next) => {
  try {
    // 1. Multipart file upload branch (V0-T08)
    if (req.file) {
      const result = await fileService.processFileUpload(req.file);
      return res.status(201).json(result);
    }

    // 2. JSON text paste branch (V0-T09)
    if (req.body && req.body.type === 'text') {
      const { content } = req.body;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw AppError.badRequest('Text content cannot be empty');
      }

      const result = await fileService.processTextPaste(content);
      return res.status(201).json(result);
    }

    // 3. Missing file payload
    throw AppError.badRequest('No file uploaded');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  uploadFile,
};
