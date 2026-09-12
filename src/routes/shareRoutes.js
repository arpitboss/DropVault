const express = require('express');
const { createShare } = require('../controllers/shareController');

const router = express.Router();

// POST /api/shares — Create a share link for an uploaded file or secret (V0-T10)
router.post('/', createShare);

module.exports = router;
