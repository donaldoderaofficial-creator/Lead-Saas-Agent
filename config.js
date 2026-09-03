/**
 * Centralized configuration system.
 * Supports environment-specific settings, feature flags, and dynamic configuration.
 * Enables flexibility and maintainability across deployment environments.
 */

require('dotenv').config();

const ENV = process.env.NODE_ENV || 'development';
const IS_PROD = ENV === 'production';
const IS_DEV = ENV === 'development';

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received: ${value}`);
  }
  return port;
}

function parseCorsOrigins(value) {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Application Configuration
const config = {
  // Environment
  env: ENV,
  isProd: IS_PROD,
  isDev: IS_DEV,
  isTest: ENV === 'test',

  // Server
  port: parsePort(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
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
    mission: 'Empowering businesses to innovate and grow through cutting-edge Innovation Design and Machine Learning, while navigating life\'s challenges together with creativity and resilience.',
    vision: 'To inspire innovation and transform businesses through creative code and design, while growing stronger together.',
    founder: 'Odera Donald Ombok, BSc',
    title: 'Founder & CEO',
    email: 'odera.ombok@dispatchpro.com',
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
      live: [process.env.PAYPAL_ENV, process.env.PAYPAL_MODE].includes('live'),
    },
    mpesa: {
      enabled: !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET),
      consumerKey: process.env.MPESA_CONSUMER_KEY,
      consumerSecret: process.env.MPESA_CONSUMER_SECRET,
      shortCode: process.env.MPESA_SHORT_CODE || process.env.MPESA_SHORTCODE,
      environment: process.env.MPESA_ENV === 'live' ? 'production' : (process.env.MPESA_ENV || 'sandbox'),
    },
  },

  wallets: {
    bitcoin: {
      enabled: !!process.env.BITCOIN_WALLET_ADDRESS,
      address: process.env.BITCOIN_WALLET_ADDRESS || null,
      currency: 'BTC',
      label: 'Bitcoin',
    },
    ethereum: {
      enabled: !!process.env.ETHEREUM_WALLET_ADDRESS,
      address: process.env.ETHEREUM_WALLET_ADDRESS || null,
      currency: 'ETH',
      label: 'Ethereum',
    },
  },

  ebook: {
    enabled: true,
    title: 'The Builder\'s Blueprint: From Zero to Profitable Product Engineer',
    subtitle: 'A practical guide to turning coding skills into income, systems, and leverage.',
    priceUsd: 19.99,
    walletAddress: process.env.BITCOIN_WALLET_ADDRESS || null,
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
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:4173,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:4173,http://127.0.0.1:5173,https://*.netlify.app'),
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
  if (config.isProd && config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }
  if (config.security.corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one allowed origin');
  }
  if (config.payment.paypal.enabled && !config.payment.paypal.clientId) {
    console.warn('PayPal enabled but credentials missing');
  }
  if (config.payment.mpesa.enabled && !config.payment.mpesa.consumerKey) {
    console.warn('M-Pesa enabled but credentials missing');
  }
  if (config.isProd && !process.env.BITCOIN_WALLET_ADDRESS) {
    throw new Error('BITCOIN_WALLET_ADDRESS must be configured in production');
  }
  if (config.isProd && !process.env.ETHEREUM_WALLET_ADDRESS) {
    throw new Error('ETHEREUM_WALLET_ADDRESS must be configured in production');
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
  parseCorsOrigins,
  parsePort,
  ENV,
  IS_PROD,
  IS_DEV,
};
