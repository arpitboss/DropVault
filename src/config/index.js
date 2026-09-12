const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/dropvault',
  masterEncryptionKey: process.env.MASTER_ENCRYPTION_KEY || '',
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 50 * 1024 * 1024,
};

module.exports = Object.freeze(config);
