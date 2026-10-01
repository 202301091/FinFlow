import { redisClient, isRedisAvailable } from '../config/redis.js';

/**
 * Safe GET operation from Redis with JSON parsing and fail-open error handling.
 *
 * @param {string} key - Cache key to retrieve
 * @returns {Promise<any|null>} Parsed value, or null if key does not exist or Redis is offline
 */
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
    console.warn(`[Redis Cache] GET failed for key "${key}":`, error.message);
    return null;
  }
};

/**
 * Safe SET operation in Redis with TTL and fail-open error handling.
 *
 * @param {string} key - Cache key
 * @param {any} value - Value to store (will be JSON-serialized)
 * @param {number} [ttlSeconds=60] - Time to live in seconds
 * @returns {Promise<boolean>} True if set successfully, false otherwise
 */
export const setCache = async (key, value, ttlSeconds = 60) => {
  if (!isRedisAvailable()) {
    return false;
  }

  try {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await redisClient.setEx(key, ttlSeconds, stringValue);
    return true;
  } catch (error) {
    console.warn(`[Redis Cache] SET failed for key "${key}":`, error.message);
    return false;
  }
};

/**
 * Safe DELETE operation for one or more keys with fail-open error handling.
 *
 * @param {string|string[]} keys - Single key or array of keys to delete
 * @returns {Promise<boolean>} True if delete succeeded or was safely bypassed, false on error
 */
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
    console.warn(`[Redis Cache] DEL failed:`, error.message);
    return false;
  }
};

/**
 * Safe pattern-based cache invalidation using SCAN iterator.
 *
 * @param {string} pattern - Wildcard pattern (e.g., "accounts:user-123:*")
 * @returns {Promise<number>} Number of keys deleted, or 0 if Redis is offline/no keys matched
 */
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
    console.warn(`[Redis Cache] SCAN and DEL failed for pattern "${pattern}":`, error.message);
    return 0;
  }
};

/**
 * Atomic fixed-window rate limit incrementer using Redis pipeline (INCR + EXPIRE).
 *
 * @param {string} key - Rate limit key (e.g. "ratelimit:login:192.168.1.1")
 * @param {number} windowSeconds - Expiry window in seconds
 * @returns {Promise<{ currentCount: number, ttl: number } | null>} Current count and remaining TTL, or null if Redis offline
 */
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
    console.warn(`[Redis RateLimiter] Atomic INCR failed for key "${key}":`, error.message);
    return null;
  }
};
