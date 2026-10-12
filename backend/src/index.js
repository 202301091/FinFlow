import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import { connectDB, pool } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { disconnectProducer } from './config/kafka.js';
import app from './app.js';
import logger from './config/logger.js';

const startServer = async () => {
  try {
    await connectDB();
    await connectRedis();

    app.on('error', (err) => {
      logger.error(`Server error: ${err.message}`);
      throw err;
    });

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });

    let isShuttingDown = false;
    const handleShutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.info(`[Server] Received ${signal}. Initiating graceful shutdown...`);

      // 10s fallback safety timer to prevent hung shutdowns
      const forceExitTimer = setTimeout(() => {
        logger.error('[Server] Forcefully exiting after 10 seconds of shutdown attempt.');
        process.exit(1);
      }, 10000);
      forceExitTimer.unref();

      // Stop accepting new connections and finish active in-flight requests
      server.close(async (err) => {
        if (err) {
          logger.error(`[Server] Error during server close: ${err.message}`);
        }

        try {
          await disconnectProducer();
          await disconnectRedis();
          await pool.end();
          logger.info('[Server] Graceful shutdown completed cleanly.');
          process.exit(0);
        } catch (cleanupError) {
          logger.error({ err: cleanupError }, `[Server] Error during resource cleanup: ${cleanupError.message}`);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('message', (msg) => {
      if (msg === 'shutdown' || msg?.action === 'shutdown') {
        handleShutdown('SIGTERM');
      }
    });
  } catch (error) {
    logger.error({ err: error }, `Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
