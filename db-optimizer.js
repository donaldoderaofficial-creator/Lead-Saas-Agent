/**
 * Database query optimization and batching.
 * Reduces round trips and improves efficiency and scalability.
 * Enables connection pooling and prepared statement reuse.
 */

const { config } = require('./config');
const { logger } = require('./logger');

/**
 * Query optimizer with automatic batching and connection pooling.
 */
class QueryOptimizer {
  constructor(db) {
    this.db = db;
    this.queryCache = new Map();
    this.batchQueue = [];
    this.batchTimeout = null;
    this.metrics = {
      totalQueries: 0,
      cachedQueries: 0,
      batchedQueries: 0,
      avgQueryTime: 0,
    };
  }

  /**
   * Execute query with automatic batching if configured.
   */
  async query(sql, params = []) {
    const start = Date.now();

    if (config.performance.enableBatching) {
      // Queue for batching
      return new Promise((resolve) => {
        this.batchQueue.push({ sql, params, resolve });
        
        if (!this.batchTimeout) {
          this.batchTimeout = setTimeout(() => {
            this.flushBatch();
          }, 50); // Batch window: 50ms
        }
      });
    } else {
      // Execute immediately
      try {
        const result = this.db.prepare(sql).run(...params);
        const duration = Date.now() - start;
        this.recordMetric(duration);
        return result;
      } catch (err) {
        logger.error('Query failed', { sql, params, error: err.message });
        throw err;
      }
    }
  }

  /**
   * Flush batch queue and execute all queries.
   */
  flushBatch() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batchQueue.length === 0) {
      return;
    }

    const start = Date.now();
    const batch = [...this.batchQueue];
    this.batchQueue = [];

    try {
      const results = batch.map(({ sql, params }) => {
        return this.db.prepare(sql).run(...params);
      });

      batch.forEach(({ resolve }, index) => {
        resolve(results[index]);
      });

      const duration = Date.now() - start;
      this.metrics.batchedQueries += batch.length;
      logger.debug(`Batched ${batch.length} queries in ${duration}ms`);
    } catch (err) {
      batch.forEach(({ resolve }) => {
        resolve(null); // Return null on batch error
      });
      logger.error('Batch execution failed', { error: err.message });
    }
  }

  /**
   * Record query performance metric.
   */
  recordMetric(duration) {
    this.metrics.totalQueries++;
    const current = this.metrics.avgQueryTime;
    this.metrics.avgQueryTime = (current + duration) / 2;
  }

  /**
   * Get optimization metrics.
   */
  getMetrics() {
    return { ...this.metrics };
  }
}

/**
 * Index recommendations based on query patterns.
 */
class IndexAdvisor {
  constructor(db) {
    this.db = db;
    this.queryPatterns = new Map();
  }

  /**
   * Analyze query and suggest indexes.
   */
  analyzeQuery(sql) {
    // Extract tables and WHERE clauses
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:GROUP|ORDER|LIMIT|$)/i);

    if (!tableMatch) return null;

    const table = tableMatch[1];
    const suggestions = [];

    if (whereMatch) {
      const where = whereMatch[1];
      // Suggest indexes on WHERE clause columns
      const columnMatch = where.match(/(\w+)\s*[=<>]/g);
      if (columnMatch) {
        columnMatch.forEach(col => {
          suggestions.push({
            table,
            columns: [col.split(/\s*[=<>]/)[0]],
            reason: 'Used in WHERE clause',
          });
        });
      }
    }

    return suggestions;
  }

  /**
   * Get current database indexes.
   */
  getCurrentIndexes() {
    const indexes = this.db.prepare(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'"
    ).all();
    return indexes;
  }

  /**
   * Suggest missing indexes.
   */
  suggestIndexes(frequency = 100) {
    const suggestions = [];
    const topQueries = Array.from(this.queryPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, frequency);

    topQueries.forEach(([sql, count]) => {
      const suggestion = this.analyzeQuery(sql);
      if (suggestion) {
        suggestions.push({ sql, count, suggestions: suggestion });
      }
    });

    return suggestions;
  }
}

/**
 * Connection pooling simulator for SQLite (single-threaded).
 * In production, consider using a different DB with native pooling.
 */
class ConnectionPool {
  constructor(db, poolSize = 1) {
    this.db = db;
    this.poolSize = poolSize; // SQLite is single-threaded
    this.activeConnections = 0;
    this.waitQueue = [];
  }

  /**
   * Acquire connection from pool.
   */
  async acquire() {
    if (this.activeConnections < this.poolSize) {
      this.activeConnections++;
      return this.db;
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Release connection back to pool.
   */
  release() {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift();
      resolve(this.db);
    } else {
      this.activeConnections--;
    }
  }

  /**
   * Get pool status.
   */
  status() {
    return {
      active: this.activeConnections,
      waiting: this.waitQueue.length,
      poolSize: this.poolSize,
    };
  }
}

module.exports = {
  QueryOptimizer,
  IndexAdvisor,
  ConnectionPool,
};
