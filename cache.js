/**
 * Simple in-memory cache with TTL support.
 * Reduces database queries and improves efficiency.
 * Enables scalability by reducing I/O burden.
 */

const { config } = require('./config');

class Cache {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Set a value with optional TTL (in seconds).
   */
  set(key, value, ttl = config.cache.ttl) {
    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    this.store.set(key, value);

    // Set expiration timer
    if (ttl > 0) {
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl * 1000);
      this.timers.set(key, timer);
    }
  }

  /**
   * Get a value, recording cache hit/miss.
   */
  get(key) {
    if (this.store.has(key)) {
      this.hits++;
      return this.store.get(key);
    }
    this.misses++;
    return null;
  }

  /**
   * Check if key exists.
   */
  has(key) {
    return this.store.has(key);
  }

  /**
   * Delete a key.
   */
  delete(key) {
    this.store.delete(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  /**
   * Clear entire cache.
   */
  clear() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.store.clear();
    this.timers.clear();
  }

  /**
   * Get cache statistics (for monitoring).
   */
  stats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(2) : 0;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      total,
      hitRate: `${hitRate}%`,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }
}

// Global cache instance
const cache = new Cache();

/**
 * Decorator: Cache function result with TTL.
 * Usage:
 *   const cachedFn = withCache(expensiveFunction, 'user_123', 300);
 *   const result = cachedFn();
 */
function withCache(fn, cacheKey, ttl = config.cache.ttl) {
  return async function (...args) {
    if (!config.cache.enabled) {
      return fn(...args);
    }

    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const result = await fn(...args);
    cache.set(cacheKey, result, ttl);
    return result;
  };
}

module.exports = {
  cache,
  withCache,
};
