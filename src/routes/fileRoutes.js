const express = require('express');
const { uploadSingleFile } = require('../middleware/upload');
const { uploadFile } = require('../controllers/fileController');
const { uploadRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// POST /api/files — Accept multipart file upload, encrypt, store, persist metadata (V0-T08, V1-T13)
router.post('/', uploadRateLimiter, uploadSingleFile, uploadFile);

module.exports = router;
