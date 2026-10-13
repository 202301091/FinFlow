import { redisClient, isRedisAvailable } from '../config/redis.js';
import logger from '../config/logger.js';

export const getCache = async (key) => {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    const rawData = await redisClient.get(key);
    if (!rawData) {
      return null;
    }

    try {
      return JSON.parse(rawData);
    } catch {
      return rawData;
    }
  } catch (error) {
    logger.warn({ err: error, key }, `[Redis Cache] GET failed for key "${key}": ${error.message}`);
    return null;
  }
};

export const setCache = async (key, value, ttlSeconds = 60) => {
  if (!isRedisAvailable()) {
    return false;
  }

  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await redisClient.setEx(key, ttlSeconds, stringValue);
    return true;
  } catch (error) {
    logger.warn({ err: error, key }, `[Redis Cache] SET failed for key "${key}": ${error.message}`);
    return false;
  }
};

export const deleteCache = async (...keys) => {
  if (!isRedisAvailable()) {
    return false;
  }

  try {
    const flattenedKeys = keys.flat().filter(Boolean);
    if (flattenedKeys.length === 0) {
      return true;
    }

    await redisClient.del(flattenedKeys);
    return true;
  } catch (error) {
    logger.warn({ err: error }, `[Redis Cache] DEL failed: ${error.message}`);
    return false;
  }
};

export const deleteCacheByPattern = async (pattern) => {
  if (!isRedisAvailable()) {
    return 0;
  }

  try {
    const matchingKeys = [];
    for await (const chunk of redisClient.scanIterator({ MATCH: pattern })) {
      if (Array.isArray(chunk)) {
        matchingKeys.push(...chunk);
      } else if (typeof chunk === 'string') {
        matchingKeys.push(chunk);
      }
    }

    if (matchingKeys.length > 0) {
      await redisClient.del(matchingKeys);
    }

    return matchingKeys.length;
  } catch (error) {
    logger.warn({ err: error, pattern }, `[Redis Cache] SCAN and DEL failed for pattern "${pattern}": ${error.message}`);
    return 0;
  }
};

export const incrementRateLimit = async (key, windowSeconds = 60) => {
  if (!isRedisAvailable()) {
    return null;
  }

  try {
    const multi = redisClient.multi();
    multi.incr(key);
    multi.ttl(key);
    const results = await multi.exec();

    const currentCount = Number(results[0]);
    let ttl = Number(results[1]);

    // If key has no expiration set (-1), initialize its TTL window
    if (ttl === -1 || currentCount === 1) {
      await redisClient.expire(key, windowSeconds);
      ttl = windowSeconds;
    }

    return { currentCount, ttl };
  } catch (error) {
    logger.warn({ err: error, key }, `[Redis RateLimiter] Atomic INCR failed for key "${key}": ${error.message}`);
    return null;
  }
};
