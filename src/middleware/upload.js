const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

const TEMP_UPLOAD_DIR = path.join(config.uploadDir, '.temp');

// Ensure temporary staging directory exists
if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
        fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
      }
      cb(null, TEMP_UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    // Generate an isolated server-side UUID temporary filename
    cb(null, `${crypto.randomUUID()}.tmp`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSize,
  },
});

const uploadSingleFile = upload.single('file');

module.exports = {
  upload,
  uploadSingleFile,
  TEMP_UPLOAD_DIR,
};
