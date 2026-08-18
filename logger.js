/**
 * Structured logging and error handling.
 * Enables maintainability, debugging, and performance monitoring.
 * Supports multiple output formats and log levels.
 */

const fs = require('fs');
const path = require('path');
const { config } = require('./config');

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  constructor() {
    this.level = LOG_LEVELS[config.logging.level] || LOG_LEVELS.info;
    this.metrics = {
      requests: 0,
      errors: 0,
      warnings: 0,
      avgResponseTime: 0,
    };

    // Ensure log directory exists
    const logDir = path.dirname(config.logging.file);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Log entry with structured format.
   */
  log(level, message, metadata = {}) {
    if (LOG_LEVELS[level] < this.level) {
      return;
    }

    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level,
      message,
      ...metadata,
    };

    // Console output (for development)
    if (config.isDev) {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        `[${timestamp}] ${level.toUpperCase()}: ${message}`,
        metadata
      );
    }

    // File output (for production)
    if (config.isProd || config.logging.file) {
      try {
        fs.appendFileSync(
          config.logging.file,
          JSON.stringify(entry) + '\n',
          'utf8'
        );
      } catch (err) {
        console.error('Failed to write log:', err);
      }
    }
  }

  debug(message, metadata) {
    this.log('debug', message, metadata);
  }

  info(message, metadata) {
    this.log('info', message, metadata);
  }

  warn(message, metadata) {
    this.log('warn', message, metadata);
    this.metrics.warnings++;
  }

  error(message, metadata) {
    this.log('error', message, metadata);
    this.metrics.errors++;
  }

  /**
   * Record request metrics.
   */
  recordRequest(method, path, statusCode, duration) {
    this.metrics.requests++;
    this.info(`${method} ${path}`, {
      statusCode,
      duration: `${duration}ms`,
    });
  }

  /**
   * Get metrics snapshot (for monitoring/observability).
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset metrics.
   */
  resetMetrics() {
    this.metrics = {
      requests: 0,
      errors: 0,
      warnings: 0,
      avgResponseTime: 0,
    };
  }
}

// Global logger instance
const logger = new Logger();

/**
 * Express middleware for request logging and metrics.
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  // Capture response end
  const originalEnd = res.end;
  res.end = function (...args) {
    const duration = Date.now() - start;
    logger.recordRequest(req.method, req.path, res.statusCode, duration);
    originalEnd.apply(res, args);
  };

  next();
}

/**
 * Express middleware for error handling.
 */
function errorHandler(err, req, res, next) {
  logger.error(`Unhandled error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  res.status(err.statusCode || 500).json({
    error: config.isDev ? err.message : 'Internal server error',
    requestId: req.id || 'unknown',
  });
}

/**
 * Wrap async route handlers to catch errors.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  logger,
  requestLogger,
  errorHandler,
  asyncHandler,
  LOG_LEVELS,
};
