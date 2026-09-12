const express = require('express');
const { uploadSingleFile } = require('../middleware/upload');
const { uploadFile } = require('../controllers/fileController');

const router = express.Router();

// POST /api/files — Accept multipart file upload, encrypt, store, persist metadata (V0-T08)
router.post('/', uploadSingleFile, uploadFile);

module.exports = router;
