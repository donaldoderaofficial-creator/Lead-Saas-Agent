/**
 * In-memory cache with TTL (Time To Live) support.
 * Reduces database queries and improves efficiency.
 * Enables scalability by reducing I/O burden.
 */

const { config } = require('./config');

/**
 * Simple in-memory cache implementation with automatic expiration.
 * Tracks cache hits and misses for monitoring performance.
 */
class Cache {
  /**
   * Create a cache instance.
   */
  constructor() {
    this.store = new Map();
    this.timers = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Set a value with optional TTL (in seconds).
   * Clears existing timer if key is being updated.
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (0 = no expiration)
   */
  set(key, value, ttl = config.cache.ttl) {
    if (typeof key !== 'string') {
      throw new Error('Cache key must be a string');
    }

    // Clear existing timer
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    this.store.set(key, value);

    // Set expiration timer if TTL is specified
    if (ttl > 0 && Number.isFinite(ttl)) {
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttl * 1000);
      this.timers.set(key, timer);
    }
  }

  /**
   * Get a value from cache, recording hit/miss.
   * @param {string} key - Cache key
   * @returns {any} Cached value or null if not found or expired
   */
  get(key) {
    if (typeof key !== 'string') {
      this.misses++;
      return null;
    }

    if (this.store.has(key)) {
      this.hits++;
      return this.store.get(key);
    }
    
    this.misses++;
    return null;
  }

  /**
   * Check if key exists in cache.
   * @param {string} key - Cache key
   * @returns {boolean} Whether key exists
   */
  has(key) {
    return typeof key === 'string' && this.store.has(key);
  }

  /**
   * Delete a key from cache and clear its timer.
   * @param {string} key - Cache key to delete
   */
  delete(key) {
    if (typeof key !== 'string') return;
    
    this.store.delete(key);
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  /**
   * Clear entire cache and cancel all timers.
   */
  clear() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.store.clear();
    this.timers.clear();
  }

  /**
   * Get cache statistics (for monitoring).
   * @returns {Object} Cache statistics
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
   * Reset statistics counters.
   */
  resetStats() {
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Cache wrapper function for caching async operations.
 * @param {string} key - Cache key
 * @param {Function} fn - Async function to cache
 * @param {number} ttl - TTL in seconds
 * @returns {Promise<any>} Cached or fresh result
 */
async function withCache(key, fn, ttl = config.cache.ttl) {
  if (typeof key !== 'string') {
    throw new Error('Cache key must be a string');
  }
  if (typeof fn !== 'function') {
    throw new Error('Second argument must be a function');
  }

  const cached = cache.get(key);
  if (cached !== null) {
    return cached;
  }

  const result = await fn();
  cache.set(key, result, ttl);
  return result;
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
