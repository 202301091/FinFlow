import { createClient } from 'redis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('[Redis] Max reconnection attempts (10) reached. Temporarily suspending retries.');
        return new Error('Redis reconnection attempts exhausted');
      }
      const delay = Math.min(retries * 100, 3000);
      return delay;
    },
  },
});

// Redis Connection Lifecycle Events
redisClient.on('connect', () => {
  console.log('[Redis] Socket connected');
});

redisClient.on('ready', () => {
  console.log('[Redis] Client ready to receive commands');
});

redisClient.on('reconnecting', () => {
  console.warn('[Redis] Reconnecting to Redis server...');
});

redisClient.on('error', (error) => {
  console.error('[Redis Client Error]:', error.message || error);
});

// Dedicated duplicate client for Redis Pub/Sub subscriptions
const redisSubscriber = redisClient.duplicate();

redisSubscriber.on('error', (error) => {
  console.error('[Redis Subscriber Error]:', error.message || error);
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
    console.error('[Redis] Initial connection failed:', error.message);
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
      await redisSubscriber.quit();
    }
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    console.error('[Redis] Disconnect error:', error.message);
  }
};

/**
 * Check if Redis is currently connected and operational
 */
const isRedisAvailable = () => Boolean(redisClient.isOpen && redisClient.isReady);

export { redisClient, redisSubscriber, connectRedis, disconnectRedis, isRedisAvailable };
export default redisClient;