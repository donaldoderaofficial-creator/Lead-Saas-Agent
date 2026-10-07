/**
 * Application constants and configuration values.
 * Centralizes magic numbers, strings, and enums for easier maintenance.
 */

// HTTP Status Codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

// Lead scoring thresholds
const LEAD_SCORE = {
  HOT_THRESHOLD: 70,
  MIN_SCORE: 0,
  MAX_SCORE: 100,
};

// Payment statuses
const PAYMENT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

// Subscription statuses
const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  TRIALING: 'trialing',
  CANCELLED: 'cancelled',
  SUSPENDED: 'suspended',
};

// Subscription tiers
const SUBSCRIPTION_TIER = {
  STARTER: 'starter',
  GROWTH: 'growth',
  SCALE: 'scale',
  NONE: 'none',
};

// Role-based access
const USER_ROLE = {
  USER: 'user',
  ADMIN: 'admin',
  SUPERADMIN: 'superadmin',
};

// Email statuses
const EMAIL_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  FAILED: 'failed',
};

// Compliance incident categories
const COMPLIANCE_CATEGORY = {
  CHILD_EXPLOITATION: 'child sexual exploitation',
  VIOLENT_CRIME: 'violent crime',
  WEAPONS: 'weapons',
  SELF_HARM: 'self-harm',
  PRIVACY: 'privacy and credentials',
  CYBERCRIME: 'cybercrime',
  FINANCIAL_CRIME: 'financial crime',
  HATE: 'hate or discrimination',
  DEFAMATION: 'defamation',
  IP_ABUSE: 'intellectual property abuse',
};

// Rate limiting windows (milliseconds)
const RATE_LIMIT = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
};

// Password requirements
const PASSWORD_REQUIREMENTS = {
  MIN_LENGTH: 12,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBERS: true,
  REQUIRE_SPECIAL: true,
};

// Token expiration times (seconds)
const TOKEN_EXPIRY = {
  TOTP: 30,
  SESSION: 24 * 60 * 60,
  CACHE: 300,
};

// Error messages (user-safe versions without sensitive details)
const ERROR_MESSAGE = {
  INVALID_INPUT: 'Invalid input provided',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Resource already exists',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  SERVER_ERROR: 'An internal error occurred. Please try again later.',
  DATABASE_ERROR: 'Database operation failed',
  PAYMENT_ERROR: 'Payment processing failed',
  VALIDATION_ERROR: 'Validation failed',
};

// Pagination defaults
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

// Database constraints
const DATABASE = {
  MAX_TEXT_LENGTH: 65535,
  MAX_STRING_LENGTH: 255,
  CONNECTION_TIMEOUT: 5000,
};

// CORS settings
const CORS = {
  ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  ALLOWED_HEADERS: ['Content-Type', 'Authorization'],
  EXPOSED_HEADERS: ['X-Total-Count', 'X-Page-Count'],
  CREDENTIALS: true,
};

// File upload limits
const FILE_UPLOAD = {
  MAX_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['application/pdf', 'text/csv', 'application/json'],
};

module.exports = {
  HTTP_STATUS,
  LEAD_SCORE,
  PAYMENT_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  USER_ROLE,
  EMAIL_STATUS,
  COMPLIANCE_CATEGORY,
  RATE_LIMIT,
  PASSWORD_REQUIREMENTS,
  TOKEN_EXPIRY,
  ERROR_MESSAGE,
  PAGINATION,
  DATABASE,
  CORS,
  FILE_UPLOAD,
};
