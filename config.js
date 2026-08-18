/**
 * Centralized configuration system.
 * Supports environment-specific settings, feature flags, and dynamic configuration.
 * Enables flexibility and maintainability across deployment environments.
 */

require('dotenv').config();

const ENV = process.env.NODE_ENV || 'development';
const IS_PROD = ENV === 'production';
const IS_DEV = ENV === 'development';

// Application Configuration
const config = {
  // Environment
  env: ENV,
  isProd: IS_PROD,
  isDev: IS_DEV,
  isTest: ENV === 'test',

  // Server
  port: parseInt(process.env.PORT || 3000),
  host: process.env.HOST || 'localhost',
  sessionSecret: process.env.SESSION_SECRET,

  // Database
  database: {
    path: process.env.DB_PATH || './data.db',
    enableWal: true,
    timeout: 5000,
    maxConnections: 1, // SQLite limitation
  },

  // Pricing Tiers (scalable, flexible)
  pricing: {
    usd: {
      starter: { price: '9.99', leads: 500 },
      growth: { price: '24.99', leads: 5000 },
      scale: { price: 'custom', leads: 'unlimited' },
    },
    kes: {
      starter: { price: 1300, leads: 500 },
      growth: { price: 3200, leads: 5000 },
      scale: { price: 'custom', leads: 'unlimited' },
    },
  },

  // Rate Limiting (security & scalability)
  rateLimiting: {
    loginAttempts: 5,
    loginWindowMs: 5 * 60 * 1000, // 5 minutes
    apiLimit: 1000, // requests per hour per user
    globalLimit: 10000, // requests per hour globally
  },

  // Caching (efficiency)
  cache: {
    enabled: true,
    ttl: 300, // seconds
    maxSize: 1000, // max cached items
  },

  // Logging (maintainability)
  logging: {
    level: IS_PROD ? 'info' : 'debug',
    format: 'json', // structured logging
    file: process.env.LOG_FILE || './logs/app.log',
  },

  // Company Profile (branding)
  company: {
    brand: 'Dispatch Pro',
    founder: 'Odera Donald Ombok, BSc',
    title: 'Founder & CEO',
    email: 'odera@dispatchpro.com',
    website: 'https://dispatchpro.com',
    supportEmail: 'support@dispatchpro.com',
  },

  // Feature Flags (flexibility, adaptability)
  features: {
    prospecting: process.env.FEATURE_PROSPECTING !== 'false',
    webhooks: process.env.FEATURE_WEBHOOKS !== 'false',
    compliance: process.env.FEATURE_COMPLIANCE !== 'false',
    subscriptions: process.env.FEATURE_SUBSCRIPTIONS !== 'false',
    twoFa: process.env.FEATURE_2FA !== 'false',
  },

  // Payment Providers
  payment: {
    paypal: {
      enabled: !!process.env.PAYPAL_CLIENT_ID,
      clientId: process.env.PAYPAL_CLIENT_ID,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET,
      live: process.env.PAYPAL_MODE === 'live',
    },
    mpesa: {
      enabled: !!process.env.MPESA_CONSUMER_KEY,
      consumerKey: process.env.MPESA_CONSUMER_KEY,
      consumerSecret: process.env.MPESA_CONSUMER_SECRET,
      shortCode: process.env.MPESA_SHORT_CODE,
    },
  },

  // Third-party APIs
  apis: {
    explorium: {
      enabled: !!process.env.EXPLORIUM_API_KEY,
      apiKey: process.env.EXPLORIUM_API_KEY,
      baseUrl: 'https://api.explorium.ai/v1',
    },
  },

  // Performance Optimization
  performance: {
    enableCompression: true,
    enableBatching: true,
    batchSize: 50,
    connectionPoolSize: 10,
  },

  // Security
  security: {
    bcryptRounds: 12,
    tokenExpiry: 8 * 60 * 60 * 1000, // 8 hours
    csrfProtection: !IS_DEV,
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  },

  // Monitoring & Analytics (maintainability, efficiency)
  monitoring: {
    enabled: IS_PROD,
    metricsInterval: 60000, // 1 minute
    errorTracking: process.env.ERROR_TRACKING_KEY,
  },
};

// Validation
function validate() {
  if (!config.sessionSecret) {
    throw new Error('Missing SESSION_SECRET environment variable');
  }
  if (config.payment.paypal.enabled && !config.payment.paypal.clientId) {
    console.warn('PayPal enabled but credentials missing');
  }
  if (config.payment.mpesa.enabled && !config.payment.mpesa.consumerKey) {
    console.warn('M-Pesa enabled but credentials missing');
  }
}

// Utility: Get config value with fallback
function get(path, defaultValue = null) {
  return path.split('.').reduce((obj, key) => obj?.[key], config) ?? defaultValue;
}

// Utility: Check if feature is enabled
function isFeatureEnabled(featureName) {
  return config.features[featureName] ?? false;
}

validate();

module.exports = {
  config,
  get,
  isFeatureEnabled,
  ENV,
  IS_PROD,
  IS_DEV,
};
