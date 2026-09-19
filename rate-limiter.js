/**
 * Rate limiting and subscription quota enforcement.
 * Enables profitability through tiered pricing and fair resource allocation.
 * Supports scalable multi-user limits and flexible quota management.
 */

const { ERROR_MESSAGE } = require('./constants');

/**
 * Rate limiter for protecting against abuse and enforcing quotas.
 * Tracks API usage per user with TTL-based reset windows.
 */
class RateLimiter {
  /**
   * Create a rate limiter instance.
   * @param {Object} options - Configuration options
   * @param {number} options.windowMs - Reset window in milliseconds
   * @param {number} options.max - Maximum requests per window
   * @param {Object} options.message - Response message when limited
   */
  constructor({ windowMs = 60 * 60 * 1000, max = 1000, message = { error: ERROR_MESSAGE.RATE_LIMITED } } = {}) {
    this.userLimits = new Map(); // userId -> { count, resetTime }
    this.globalLimits = new Map(); // endpoint -> { count, resetTime }
    this.windowMs = windowMs;
    this.max = max;
    this.message = message;
  }

  /**
   * Check if user has exceeded rate limit.
   * Increments counter if within limit.
   * @param {string} userId - Unique user identifier
   * @param {number} limit - Request limit for this window
   * @param {number} windowMs - Time window in milliseconds
   * @returns {boolean} Whether user is rate limited
   */
  isLimited(userId, limit, windowMs) {
    if (typeof userId !== 'string' || !Number.isFinite(limit) || !Number.isFinite(windowMs)) {
      return false; // Invalid parameters, allow request
    }
    
    const now = Date.now();
    const entry = this.userLimits.get(userId) || { count: 0, resetTime: now + windowMs };

    if (now > entry.resetTime) {
      // Window expired, reset
      entry.count = 0;
      entry.resetTime = now + windowMs;
    }

    const isLimited = entry.count >= limit;
    if (!isLimited) {
      entry.count++;
    }

    this.userLimits.set(userId, entry);
    return isLimited;
  }

  /**
   * Get remaining quota for user.
   * @param {string} userId - Unique user identifier
   * @param {number} limit - Request limit for this window
   * @param {number} windowMs - Time window in milliseconds
   * @returns {number} Remaining requests in current window
   */
  getRemaining(userId, limit, windowMs) {
    if (typeof userId !== 'string' || !Number.isFinite(limit)) {
      return limit; // Invalid parameters, assume full quota
    }
    
    const now = Date.now();
    const entry = this.userLimits.get(userId) || { count: 0, resetTime: now + windowMs };

    if (now > entry.resetTime) {
      return limit;
    }

    return Math.max(0, limit - entry.count);
  }

  /**
   * Reset limit for user (admin action).
   * @param {string} userId - User identifier to reset
   */
  reset(userId) {
    if (typeof userId !== 'string') return;
    this.userLimits.delete(userId);
  }

  /**
   * Clear all rate limit data.
   */
  clear() {
    this.userLimits.clear();
  }

  /**
   * Express middleware for rate limiting.
   * @returns {Function} Express middleware function
   */
  middleware() {
    return (req, res, next) => {
      if (this.isLimited(req.ip, this.max, this.windowMs)) {
        return res.status(429).json(this.message);
      }
      next();
    };
  }
}

module.exports = { RateLimiter };
