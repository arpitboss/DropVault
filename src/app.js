const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { getDBStatus, isConnected } = require('./config/db');
const { getRedisStatus, isRedisConnected } = require('./config/redis');
const fileRoutes = require('./routes/fileRoutes');
const shareRoutes = require('./routes/shareRoutes');
const { accessShare, verifySharePassword } = require('./controllers/shareController');
const { shareRateLimiter } = require('./middleware/rateLimiter');

const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// Request correlation ID and structured request logger (V0-T13, LOG-1, LOG-2)
app.use(requestLogger);

// Standard middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static UI assets (V0-T12)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint reporting service, DB, and Redis status (V0-T01, V0-T02, V1-T01)
app.get('/health', (req, res) => {
  const dbStatus = getDBStatus();
  const dbOk = isConnected();
  const redisStatus = getRedisStatus();
  const redisOk = isRedisConnected();

  const isHealthy = dbOk && redisOk;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    db: {
      status: dbStatus,
    },
    redis: {
      status: redisStatus,
    },
  });
});

// API Routes
app.use('/api/files', fileRoutes);
app.use('/api/shares', shareRoutes);

// Ephemeral Share Access Endpoints (V0-T11, V1-T10, V1-T13, TOK-5)
app.get('/s/:shortCode', shareRateLimiter, accessShare);
app.post('/s/:shortCode', shareRateLimiter, accessShare);
app.post('/s/:shortCode/verify', shareRateLimiter, verifySharePassword);

// 404 handler for undefined routes (V0-T13)
app.use(notFoundHandler);

// Centralized Error Handling Middleware (V0-T13)
app.use(errorHandler);

module.exports = app;

