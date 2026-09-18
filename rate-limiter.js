/**
 * Rate limiting and subscription quota enforcement.
 * Enables profitability through tiered pricing and fair resource allocation.
 * Supports scalable multi-user limits and flexible quota management.
 */

const { config } = require('./config');

/**
 * Track API usage per user with TTL-based reset.
 */
class RateLimiter {
  constructor({ windowMs = 60 * 60 * 1000, max = 1000, message = { error: 'Too many requests.' } } = {}) {
    this.userLimits = new Map(); // userId -> { count, resetTime }
    this.globalLimits = new Map(); // endpoint -> { count, resetTime }
    this.windowMs = windowMs;
    this.max = max;
    this.message = message;
  }

  /**
   * Check if user has exceeded rate limit.
   */
  isLimited(userId, limit, windowMs) {
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
   */
  getRemaining(userId, limit, windowMs) {
    const now = Date.now();
    const entry = this.userLimits.get(userId) || { count: 0, resetTime: now + windowMs };

    if (now > entry.resetTime) {
      return limit;
    }

    return Math.max(0, limit - entry.count);
  }

  /**
   * Reset limit for user (admin action).
   */
  reset(userId) {
    this.userLimits.delete(userId);
  }

  /**
   * Clear all limits.
   */
  clear() {
    this.userLimits.clear();
  }

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
