/**
 * Input validation and sanitization utilities.
 * Prevents injection attacks, malformed data, and improves data quality.
 */

const { PASSWORD_REQUIREMENTS, ERROR_MESSAGE } = require('./constants');

/**
 * Validate and sanitize email address.
 * @param {string} email - Email to validate
 * @returns {string|null} Normalized email or null if invalid
 */
function validateEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  // RFC 5322 simplified pattern
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(normalized) ? normalized : null;
}

/**
 * Validate password strength.
 * @param {string} password - Password to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
function validatePassword(password) {
  const errors = [];

  if (typeof password !== 'string') {
    return { valid: false, errors: ['Password must be a string'] };
  }

  if (password.length < PASSWORD_REQUIREMENTS.MIN_LENGTH) {
    errors.push(`Minimum ${PASSWORD_REQUIREMENTS.MIN_LENGTH} characters required`);
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    errors.push('Must contain uppercase letter');
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
    errors.push('Must contain lowercase letter');
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_NUMBERS && !/\d/.test(password)) {
    errors.push('Must contain number');
  }

  if (PASSWORD_REQUIREMENTS.REQUIRE_SPECIAL && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Must contain special character (!@#$%^&*)');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Sanitize string to prevent XSS attacks.
 * Removes dangerous HTML/JS characters while preserving safe content.
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and normalize phone number.
 * @param {string} phone - Phone number to validate
 * @returns {string|null} Normalized phone or null if invalid
 */
function validatePhone(phone) {
  if (typeof phone !== 'string') return null;
  const cleaned = phone.trim().replace(/[\s\-()]/g, '');
  // Basic international format check: + followed by 7-15 digits
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Validate username format.
 * @param {string} username - Username to validate
 * @returns {boolean} Whether username is valid
 */
function validateUsername(username) {
  if (typeof username !== 'string') return false;
  // Allow alphanumeric, dots, underscores, hyphens. 3-32 chars
  return /^[a-zA-Z0-9._-]{3,32}$/.test(username);
}

/**
 * Validate URL format.
 * @param {string} url - URL to validate
 * @returns {boolean} Whether URL is valid
 */
function validateUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate JSON object structure.
 * @param {any} obj - Object to validate
 * @param {Object} schema - Schema validation object {field: type}
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
function validateSchema(obj, schema) {
  const errors = [];

  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['Input must be an object'] };
  }

  for (const [field, expectedType] of Object.entries(schema)) {
    const value = obj[field];
    const actualType = value === null ? 'null' : typeof value;

    if (actualType !== expectedType) {
      errors.push(`Field '${field}' must be ${expectedType}, got ${actualType}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate lead data.
 * @param {Object} lead - Lead object to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
function validateLeadData(lead) {
  const errors = [];

  if (typeof lead !== 'object' || lead === null) {
    return { valid: false, errors: ['Lead must be an object'] };
  }

  // Validate required fields
  if (!lead.name || typeof lead.name !== 'string' || lead.name.trim().length === 0) {
    errors.push('Name is required and must be non-empty string');
  } else if (lead.name.length > 255) {
    errors.push('Name must not exceed 255 characters');
  }

  if (!lead.email) {
    errors.push('Email is required');
  } else if (!validateEmail(lead.email)) {
    errors.push('Email must be valid');
  }

  // Validate optional fields
  if (lead.phone && !validatePhone(lead.phone)) {
    errors.push('Phone number format is invalid');
  }

  if (lead.companySize && !['small', 'medium', 'enterprise'].includes(lead.companySize)) {
    errors.push('Company size must be small, medium, or enterprise');
  }

  if (lead.product && typeof lead.product !== 'string') {
    errors.push('Product must be a string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Escape special SQL characters (basic protection, use prepared statements when possible).
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeSql(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Validate pagination parameters.
 * @param {number} page - Page number
 * @param {number} limit - Results per page
 * @returns {{page: number, limit: number, offset: number}} Normalized parameters
 */
function validatePagination(page = 1, limit = 20) {
  const parsedPage = Math.max(1, Math.floor(Number(page)) || 1);
  const parsedLimit = Math.max(1, Math.min(100, Math.floor(Number(limit)) || 20));
  const offset = (parsedPage - 1) * parsedLimit;

  return { page: parsedPage, limit: parsedLimit, offset };
}

/**
 * Sanitize object for logging (removes sensitive fields).
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
function sanitizeForLogging(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = { ...obj };
  const sensitiveFields = ['password', 'secret', 'token', 'apiKey', 'clientSecret', 'privateKey'];

  sensitiveFields.forEach(field => {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Validate and normalize payment amount.
 * @param {number} amount - Amount to validate
 * @param {number} min - Minimum allowed
 * @param {number} max - Maximum allowed
 * @returns {number|null} Validated amount or null
 */
function validateAmount(amount, min = 0, max = 999999) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return Math.round(num * 100) / 100; // Round to 2 decimals
}

module.exports = {
  validateEmail,
  validatePassword,
  sanitizeString,
  validatePhone,
  validateUsername,
  validateUrl,
  validateSchema,
  validateLeadData,
  escapeSql,
  validatePagination,
  sanitizeForLogging,
  validateAmount,
};
