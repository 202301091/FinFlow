import { createClient } from 'redis';
import logger from './logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('[Redis] Max reconnection attempts (10) reached. Temporarily suspending retries.');
        return new Error('Redis reconnection attempts exhausted');
      }
      const delay = Math.min(retries * 100, 3000);
      return delay;
    },
  },
});

// Redis Connection Lifecycle Events
redisClient.on('connect', () => {
  logger.info('[Redis] Socket connected');
});

redisClient.on('ready', () => {
  logger.info('[Redis] Client ready to receive commands');
});

redisClient.on('reconnecting', () => {
  logger.warn('[Redis] Reconnecting to Redis server...');
});

redisClient.on('error', (error) => {
  logger.error({ err: error }, `[Redis Client Error]: ${error.message || error}`);
});

// Dedicated duplicate client for Redis Pub/Sub subscriptions
const redisSubscriber = redisClient.duplicate();

redisSubscriber.on('error', (error) => {
  logger.error({ err: error }, `[Redis Subscriber Error]: ${error.message || error}`);
});

/**
 * Idempotently connect to Redis without throwing if already open
 * Allows application to continue running even if Redis is unavailable (fail-open)
 */
const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    if (!redisSubscriber.isOpen) {
      await redisSubscriber.connect();
    }
    return redisClient;
  } catch (error) {
    logger.error({ err: error }, `[Redis] Initial connection failed: ${error.message}`);
    // Graceful degradation: do not crash the app, return null
    return null;
  }
};

/**
 * Gracefully disconnect Redis client and subscriber
 */
const disconnectRedis = async () => {
  try {
    if (redisSubscriber.isOpen) {
      try {
        await redisSubscriber.unsubscribe();
      } catch {}
      await redisSubscriber.disconnect();
    }
    if (redisClient.isOpen) {
      await redisClient.disconnect();
    }
  } catch (error) {
    logger.error({ err: error }, `[Redis] Disconnect error: ${error.message}`);
  }
};

/**
 * Check if Redis is currently connected and operational
 */
const isRedisAvailable = () => Boolean(redisClient.isOpen && redisClient.isReady);

export { redisClient, redisSubscriber, connectRedis, disconnectRedis, isRedisAvailable };
export default redisClient;