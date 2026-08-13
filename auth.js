/**
 * Auth helpers: password hashing (bcryptjs) and TOTP 2FA (otplib) —
 * the same style of 2FA as Google Authenticator / Authy.
 */

const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateTotpSecret() {
  return authenticator.generateSecret();
}

function verifyTotpCode(code, secret) {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

async function generateQrCode(username, secret) {
  const otpauthUrl = authenticator.keyuri(username, 'Lead Agent Dashboard', secret);
  return QRCode.toDataURL(otpauthUrl);
}

module.exports = { hashPassword, verifyPassword, generateTotpSecret, verifyTotpCode, generateQrCode };
