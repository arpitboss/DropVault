const app = require('./app');
const config = require('./config');
const { connectDB, disconnectDB } = require('./config/db');

let server;

const startServer = async () => {
  try {
    // 1. Establish MongoDB connection
    await connectDB(config.mongoUri);

    // 2. Start HTTP listener
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
        process.exit(0);
      } catch (err) {
        console.error('[DropVault] Error during DB disconnection:', err.message);
        process.exit(1);
      }
    });
  } else {
    await disconnectDB();
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, gracefulShutdown };
