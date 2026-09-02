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

/**
 * Subscription tier definitions and quota enforcement.
 */
const TIERS = {
  starter: {
    name: 'Starter',
    leads: 500,
    apiCallsPerHour: 1000,
    prospectsPerMonth: 100,
    price: 9.99,
    currency: 'USD',
  },
  growth: {
    name: 'Growth',
    leads: 5000,
    apiCallsPerHour: 10000,
    prospectsPerMonth: 5000,
    price: 24.99,
    currency: 'USD',
  },
  scale: {
    name: 'Scale',
    leads: 'unlimited',
    apiCallsPerHour: 'unlimited',
    prospectsPerMonth: 'unlimited',
    price: 'custom',
    currency: 'USD',
  },
};

/**
 * Check if user has exceeded quota for this month.
 */
function checkQuota(user, quotaType) {
  const tier = user.tier || 'starter';
  const tierConfig = TIERS[tier];

  if (!tierConfig) {
    return { allowed: false, reason: 'Invalid subscription tier' };
  }

  const quota = tierConfig[quotaType];
  if (quota === 'unlimited') {
    return { allowed: true };
  }

  // Get current usage (from database)
  // This would be implemented with actual database queries
  const usage = user[`${quotaType}_used`] || 0;

  return {
    allowed: usage < quota,
    used: usage,
    quota: quota,
    remaining: Math.max(0, quota - usage),
  };
}

/**
 * Increment quota usage counter.
 */
function incrementQuota(user, quotaType, amount = 1) {
  const key = `${quotaType}_used`;
  user[key] = (user[key] || 0) + amount;
  return user[key];
}

/**
 * Get pricing for all tiers.
 */
function getPricing(currency = 'USD') {
  const tiers = { ...TIERS };
  if (currency === 'KES') {
    // Convert to KES (simplified; use actual exchange rates in production)
    Object.keys(tiers).forEach(key => {
      if (typeof tiers[key].price === 'number') {
        tiers[key].price = Math.round(tiers[key].price * 130); // ~1 USD = 130 KES
      }
    });
  }
  return tiers;
}

/**
 * Get tier upgrade recommendation based on usage.
 */
function getUpgradeRecommendation(user) {
  const tier = user.tier || 'starter';
  const tierConfig = TIERS[tier];

  if (tier === 'scale') {
    return null; // Already on highest tier
  }

  const leadsUsagePercent = (user.leads_used || 0) / tierConfig.leads * 100;
  const apiUsagePercent = (user.api_calls_used || 0) / tierConfig.apiCallsPerHour * 100;

  if (leadsUsagePercent > 80 || apiUsagePercent > 80) {
    const nextTier = tier === 'starter' ? 'growth' : 'scale';
    return {
      recommended: nextTier,
      reason: 'You\'re approaching your plan limits',
      savings: TIERS[nextTier].price < TIERS[tier].price * 1.5
        ? 'Better value at higher tier'
        : 'No cost advantage yet',
    };
  }

  return null;
}

module.exports = {
  RateLimiter,
  TIERS,
  checkQuota,
  incrementQuota,
  getPricing,
  getUpgradeRecommendation,
};
