/**
 * Centralized configuration system.
 * Supports environment-specific settings, feature flags, and dynamic configuration.
 * Enables flexibility and maintainability across deployment environments.
 */

require('dotenv').config();

const ENV = process.env.NODE_ENV || 'development';
const IS_PROD = ENV === 'production';
const IS_DEV = ENV === 'development';
const {
  DEFAULT_BITCOIN_WALLET_ADDRESS,
  DEFAULT_PRICING_USD,
  DEFAULT_EBOOK,
  resolveWallets,
} = require('./payment-catalog');

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

function getDefaultCorsOrigins() {
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4173',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:5173',
  ];

  if (process.env.PUBLIC_APP_URL) {
    origins.push(process.env.PUBLIC_APP_URL);
  }

  return origins;
}

function validateProductionConfig(input = {}) {
  const configToValidate = input || {};
  const environment = configToValidate.env || ENV;

  if (environment !== 'production') {
    return [];
  }

  const errors = [];
  const sessionSecret = configToValidate.sessionSecret ?? process.env.SESSION_SECRET ?? '';
  const publicAppUrl = configToValidate.publicAppUrl ?? process.env.PUBLIC_APP_URL ?? '';
  const corsOrigins = Array.isArray(configToValidate.corsOrigins)
    ? configToValidate.corsOrigins
    : parseCorsOrigins(configToValidate.corsOrigins ?? process.env.CORS_ORIGINS ?? '');
  const paypal = configToValidate.paypal || {};
  const mpesa = configToValidate.mpesa || {};
  const wallets = configToValidate.wallets || {};

  if (!sessionSecret || sessionSecret.trim().length < 32) {
    errors.push('SESSION_SECRET must be set to a value at least 32 characters long in production.');
  }

  if (!publicAppUrl || !/^https?:\/\//.test(publicAppUrl)) {
    errors.push('PUBLIC_APP_URL must be set to the deployed app origin in production.');
  }

  if (!corsOrigins.length) {
    errors.push('CORS_ORIGINS must contain at least one allowed origin in production.');
  }

  if (paypal.enabled && (!paypal.clientId || !paypal.clientSecret)) {
    errors.push('PayPal is enabled but the required PayPal client credentials are missing.');
  }

  if (mpesa.enabled && (!mpesa.consumerKey || !mpesa.consumerSecret || !mpesa.callbackUrl)) {
    errors.push('M-Pesa is enabled but the required consumer key, consumer secret, or callback URL are missing.');
  }

  if (!wallets.bitcoin?.address) {
    errors.push('BITCOIN_WALLET_ADDRESS must be configured in production.');
  }

  if (!wallets.ethereum?.address) {
    errors.push('ETHEREUM_WALLET_ADDRESS must be configured in production.');
  }

  return errors;
}

function buildProductionSmokeCheckStatus(input = {}) {
  const configToCheck = input || {};
  const environment = configToCheck.env || ENV;

  if (environment !== 'production') {
    return {
      status: 'skipped',
      checks: [],
      missing: [],
    };
  }

  const checks = [
    { name: 'sessionSecret', passed: Boolean(configToCheck.sessionSecret && configToCheck.sessionSecret.length >= 32), label: 'SESSION_SECRET' },
    { name: 'publicAppUrl', passed: Boolean(configToCheck.publicAppUrl && /^https?:\/\//.test(configToCheck.publicAppUrl)), label: 'PUBLIC_APP_URL' },
    { name: 'corsOrigins', passed: Array.isArray(configToCheck.corsOrigins) ? configToCheck.corsOrigins.length > 0 : Boolean(configToCheck.corsOrigins), label: 'CORS_ORIGINS' },
    { name: 'bitcoinWallet', passed: Boolean(configToCheck.wallets?.bitcoin?.address), label: 'BITCOIN_WALLET_ADDRESS' },
    { name: 'ethereumWallet', passed: Boolean(configToCheck.wallets?.ethereum?.address), label: 'ETHEREUM_WALLET_ADDRESS' },
    { name: 'paypal', passed: !(configToCheck.paypal?.enabled) || Boolean(configToCheck.paypal?.clientId && configToCheck.paypal?.clientSecret), label: 'PayPal configuration' },
    { name: 'mpesa', passed: !(configToCheck.mpesa?.enabled) || Boolean(configToCheck.mpesa?.consumerKey && configToCheck.mpesa?.consumerSecret && configToCheck.mpesa?.callbackUrl), label: 'M-Pesa configuration' },
  ];

  const missing = checks.filter((check) => !check.passed).map((check) => check.label);

  return {
    status: missing.length === 0 ? 'ready' : 'not_ready',
    checks,
    missing,
  };
}

// Application Configuration
const config = {
  // Environment
  env: ENV,
  isProd: IS_PROD,
  isDev: IS_DEV,
  isTest: ENV === 'test',

  // Server
  port: parsePort(process.env.PORT || 8000),
  host: process.env.HOST || '0.0.0.0',
  sessionSecret: process.env.SESSION_SECRET,
  publicAppUrl: process.env.PUBLIC_APP_URL || null,
  emailWebhookSecret: process.env.EMAIL_WEBHOOK_SECRET || null,

  // Database
  database: {
    path: process.env.DB_PATH || './data.db',
    enableWal: true,
    timeout: 5000,
    maxConnections: 1, // SQLite limitation
  },

  // Pricing Tiers (scalable, flexible)
  pricing: {
    usd: DEFAULT_PRICING_USD,
    kes: {
      starter: { price: 10200, leads: 500 },
      growth: { price: 32200, leads: 5000 },
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
    releaseAttribution: 'Odera Donald Ombok, BSc - Founder & CEO, Dispatch Pro',
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
      enabled: true,
      configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
      clientId: process.env.PAYPAL_CLIENT_ID,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET,
      live: [process.env.PAYPAL_ENV, process.env.PAYPAL_MODE].includes('live'),
    },
    mpesa: {
      enabled: true,
      configured: Boolean(
        process.env.MPESA_CONSUMER_KEY
        && process.env.MPESA_CONSUMER_SECRET
        && (process.env.MPESA_SHORT_CODE || process.env.MPESA_SHORTCODE)
        && process.env.MPESA_PASSKEY
        && process.env.MPESA_CALLBACK_URL
      ),
      consumerKey: process.env.MPESA_CONSUMER_KEY,
      consumerSecret: process.env.MPESA_CONSUMER_SECRET,
      shortCode: process.env.MPESA_SHORT_CODE || process.env.MPESA_SHORTCODE,
      environment: process.env.MPESA_ENV === 'live' ? 'production' : (process.env.MPESA_ENV || 'sandbox'),
    },
  },

  wallets: resolveWallets(process.env),

  ebook: {
    ...DEFAULT_EBOOK,
    walletAddress: process.env.BITCOIN_WALLET_ADDRESS || DEFAULT_BITCOIN_WALLET_ADDRESS,
  },

  // Third-party APIs
  apis: {
    explorium: {
      enabled: !!process.env.EXPLORIUM_API_KEY,
      apiKey: process.env.EXPLORIUM_API_KEY,
      baseUrl: 'https://api.explorium.ai/v1',
    },
  },

  // Geospatial safety reporting
  geospatial: {
    dataset: process.env.GEOSPATIAL_DATASET_JSON || null,
    authorityEscalationUrl: process.env.AUTHORITY_ESCALATION_URL || null,
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
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS || getDefaultCorsOrigins().join(',')),
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
  const errors = validateProductionConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  if (!config.sessionSecret) {
    throw new Error('Missing SESSION_SECRET environment variable');
  }
  if (config.isProd && config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }
  if (config.security.corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one allowed origin');
  }
  if (config.payment.paypal.configured && !config.payment.paypal.clientId) {
    console.warn('PayPal enabled but credentials missing');
  }
  if (config.payment.mpesa.configured && !config.payment.mpesa.consumerKey) {
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
  parseCorsOrigins,
  parsePort,
  validateProductionConfig,
  buildProductionSmokeCheckStatus,
  ENV,
  IS_PROD,
  IS_DEV,
};
