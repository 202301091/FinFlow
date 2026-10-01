import { incrementRateLimit } from '../utils/redis.util.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Factory function to create distributed, Redis-backed rate limiting middleware.
 *
 * @param {Object} options
 * @param {string} options.tier - Name of the protected route tier (e.g. 'login', 'transfer')
 * @param {number} options.limit - Maximum number of allowed requests in the window
 * @param {number} options.windowSeconds - Window length in seconds
 * @param {Function} [options.keyGenerator] - Optional custom key generator (defaults to userId || IP)
 * @returns {Function} Express middleware function
 */
export const createRateLimiter = ({
  tier = 'standard',
  limit = 100,
  windowSeconds = 60,
  keyGenerator = null,
} = {}) => {
  return async (req, res, next) => {
    try {
      // 1. Determine client identifier (User ID for authenticated routes, IP for unauthenticated routes)
      const identifier = keyGenerator
        ? keyGenerator(req)
        : req.user?.id
          ? `user:${req.user.id}`
          : `ip:${req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1'}`;

      const key = `ratelimit:${tier}:${identifier}`;

      // 2. Perform atomic Redis increment and TTL query
      const result = await incrementRateLimit(key, windowSeconds);

      // 3. Fail-open if Redis is down or unavailable (do not deny legitimate traffic)
      if (!result) {
        return next();
      }

      const { currentCount, ttl } = result;

      // 4. Attach standard RateLimit headers to HTTP response
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - currentCount));
      res.setHeader('X-RateLimit-Reset', ttl);

      // 5. Enforce limit threshold
      if (currentCount > limit) {
        res.setHeader('Retry-After', ttl);
        return res
          .status(429)
          .json(
            new ApiError(
              429,
              `Too many requests for ${tier}. Please try again after ${ttl} seconds.`
            )
          );
      }

      next();
    } catch (error) {
      console.error(`[RateLimiter] Error on ${tier}:`, error.message);
      // Fail-open: Redis is auxiliary defense; never crash HTTP flow on limiter errors
      next();
    }
  };
};

// Route-specific rate limiters with environment-driven configurations
export const loginRateLimiter = createRateLimiter({
  tier: 'login',
  limit: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20,
  windowSeconds: Number(process.env.RATE_LIMIT_LOGIN_WINDOW) || 60,
});

export const registerRateLimiter = createRateLimiter({
  tier: 'register',
  limit: Number(process.env.RATE_LIMIT_REGISTER_MAX) || 20,
  windowSeconds: Number(process.env.RATE_LIMIT_REGISTER_WINDOW) || 60,
});

export const transferRateLimiter = createRateLimiter({
  tier: 'transfer',
  limit: Number(process.env.RATE_LIMIT_TRANSFER_MAX) || 30,
  windowSeconds: Number(process.env.RATE_LIMIT_TRANSFER_WINDOW) || 60,
});

export const standardRateLimiter = createRateLimiter({
  tier: 'general',
  limit: Number(process.env.RATE_LIMIT_GLOBAL_MAX) || 100,
  windowSeconds: Number(process.env.RATE_LIMIT_GLOBAL_WINDOW) || 60,
});

// Backward compatibility exports
export const ratelimiter = standardRateLimiter;
export default standardRateLimiter;