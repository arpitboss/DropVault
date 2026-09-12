const express = require('express');
const { getDBStatus, isConnected } = require('./config/db');

const app = express();

// Standard middleware
app.use(express.json());
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

module.exports = app;
