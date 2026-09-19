/**
 * Authentication helpers: password hashing (bcryptjs), TOTP 2FA (otplib).
 * Implements security best practices for user authentication and verification.
 */

const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { PASSWORD_REQUIREMENTS } = require('./constants');

/**
 * Hash password using bcryptjs with salt rounds.
 * @param {string} password - Password to hash
 * @returns {Promise<string>} Hashed password
 * @throws {Error} If password is invalid
 */
async function hashPassword(password) {
  if (typeof password !== 'string') {
    throw new Error('Password must be a string');
  }
  if (password.length < PASSWORD_REQUIREMENTS.MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_REQUIREMENTS.MIN_LENGTH} characters`);
  }
  return bcrypt.hash(password, 12);
}

/**
 * Verify password against stored hash.
 * @param {string} password - Password to verify
 * @param {string} hash - Stored hash
 * @returns {Promise<boolean>} Whether password matches hash
 */
async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string') {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    return false;
  }
}

/**
 * Generate TOTP secret for two-factor authentication.
 * @returns {string} TOTP secret
 */
function generateTotpSecret() {
  return authenticator.generateSecret();
}

/**
 * Verify TOTP code against secret.
 * Allows time window of +/- 1 interval for clock skew.
 * @param {string} code - Code from authenticator app
 * @param {string} secret - TOTP secret
 * @returns {boolean} Whether code is valid
 */
function verifyTotpCode(code, secret) {
  if (typeof code !== 'string' || typeof secret !== 'string') {
    return false;
  }
  try {
    return authenticator.verify({ token: code, secret, window: 1 });
  } catch {
    return false;
  }
}

/**
 * Generate QR code for TOTP setup.
 * @param {string} username - Username for identification
 * @param {string} secret - TOTP secret
 * @returns {Promise<string>} Data URL for QR code image
 */
async function generateQrCode(username, secret) {
  if (typeof username !== 'string' || typeof secret !== 'string') {
    throw new Error('Username and secret must be strings');
  }
  const otpauthUrl = authenticator.keyuri(username, 'Lead Agent Dashboard', secret);
  return QRCode.toDataURL(otpauthUrl);
}

module.exports = { hashPassword, verifyPassword, generateTotpSecret, verifyTotpCode, generateQrCode };
