const express = require('express');
const multer = require('multer');
const config = require('./config');
const { getDBStatus, isConnected } = require('./config/db');
const fileRoutes = require('./routes/fileRoutes');
const shareRoutes = require('./routes/shareRoutes');

const app = express();

// Standard middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint reporting service & DB status (V0-T01, V0-T02)
app.get('/health', (req, res) => {
  const dbStatus = getDBStatus();
  const dbOk = isConnected();

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: {
      status: dbStatus,
    },
  });
});

// API Routes
app.use('/api/files', fileRoutes);
app.use('/api/shares', shareRoutes);

// Error Handling Middleware (catching Multer limits, body-parser limits, and general errors)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File size exceeds the limit of ${config.maxFileSize} bytes`,
      });
    }
    return res.status(400).json({
      error: err.message,
    });
  }

  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: `Text content exceeds maximum limit of ${config.maxTextSize} bytes`,
    });
  }

  if (err) {
    const status = err.status || 500;
    return res.status(status).json({
      error: err.message || 'Internal server error',
    });
  }

  next();
});

module.exports = app;

