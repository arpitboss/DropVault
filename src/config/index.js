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
  maxTextSize: parseInt(process.env.MAX_TEXT_SIZE, 10) || 1 * 1024 * 1024,
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT, 10) || 6379,
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisUrl: process.env.REDIS_URL || undefined,
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    strictLimit: parseInt(process.env.RATE_LIMIT_STRICT_MAX, 10) || 5,
    strictWindow: parseInt(process.env.RATE_LIMIT_STRICT_WINDOW, 10) || 60,
    uploadLimit: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX, 10) || 20,
    uploadWindow: parseInt(process.env.RATE_LIMIT_UPLOAD_WINDOW, 10) || 60,
    shareLimit: parseInt(process.env.RATE_LIMIT_SHARE_MAX, 10) || 60,
    shareWindow: parseInt(process.env.RATE_LIMIT_SHARE_WINDOW, 10) || 60,
    globalLimit: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX, 10) || 120,
    globalWindow: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW, 10) || 60,
  },
};

module.exports = Object.freeze(config);
