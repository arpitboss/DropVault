const app = require('./app');
const config = require('./config');
const { connectDB, disconnectDB } = require('./config/db');
const { connectRedis, disconnectRedis } = require('./config/redis');

let server;

const startServer = async () => {
  try {
    // 1. Establish MongoDB connection
    await connectDB(config.mongoUri);

    // 2. Establish Redis connection (V1-T01)
    try {
      await connectRedis();
    } catch (redisErr) {
      console.warn(`[DropVault] Initial Redis connection failed: ${redisErr.message}. Reconnect strategy active.`);
    }

    // 3. Start HTTP listener
    server = app.listen(config.port, () => {
      console.log(`[DropVault] Server listening on port ${config.port} (environment: ${config.nodeEnv})`);
    });

    return server;
  } catch (error) {
    console.error(`[DropVault] Server startup aborted due to error: ${error.message}`);
    process.exit(1);
  }
};

const gracefulShutdown = async (signal) => {
  console.log(`[DropVault] Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      console.log('[DropVault] HTTP server closed.');
      try {
        await disconnectDB();
        await disconnectRedis();
        process.exit(0);
      } catch (err) {
        console.error('[DropVault] Error during disconnection:', err.message);
        process.exit(1);
      }
    });
  } else {
    await disconnectDB();
    await disconnectRedis();
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, gracefulShutdown };
