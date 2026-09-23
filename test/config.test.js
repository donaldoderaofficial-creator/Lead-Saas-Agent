const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { parseCorsOrigins, parsePort, validateProductionConfig } = require('../config');

test('parses and trims configured CORS origins', () => {
  assert.deepEqual(
    parseCorsOrigins(' https://app.example.com, http://localhost:3000 '),
    ['https://app.example.com', 'http://localhost:3000']
  );
});

test('rejects invalid ports', () => {
  assert.throws(() => parsePort('70000'), /PORT must be an integer/);
  assert.throws(() => parsePort('not-a-port'), /PORT must be an integer/);
});

test('accepts valid ports', () => {
  assert.equal(parsePort('3000'), 3000);
});

test('requires production-only secrets before startup', () => {
  const errors = validateProductionConfig({
    env: 'production',
    sessionSecret: '',
    publicAppUrl: '',
    corsOrigins: [],
    paypal: { enabled: true, clientId: '', clientSecret: '' },
    mpesa: { enabled: true, consumerKey: '', consumerSecret: '', callbackUrl: '' },
    emailWebhookSecret: '',
    wallets: { bitcoin: { address: '' }, ethereum: { address: '' } }
  });

  assert.ok(errors.some((error) => /SESSION_SECRET/.test(error)));
  assert.ok(errors.some((error) => /CORS_ORIGINS/.test(error)));
  assert.ok(errors.some((error) => /PayPal/.test(error)));
  assert.ok(errors.some((error) => /M-Pesa/.test(error)));
});

test('allows production config when required values are present', () => {
  const errors = validateProductionConfig({
    env: 'production',
    sessionSecret: 'a-very-long-production-secret-value-1234',
    publicAppUrl: 'https://example.com',
    corsOrigins: ['https://example.com'],
    paypal: { enabled: true, clientId: 'paypal-client-id', clientSecret: 'paypal-secret' },
    mpesa: { enabled: true, consumerKey: 'mpesa-key', consumerSecret: 'mpesa-secret', callbackUrl: 'https://example.com/payments/mpesa/callback' },
    emailWebhookSecret: 'email-secret',
    wallets: { bitcoin: { address: 'bc1qvalidwallet' }, ethereum: { address: '0x1111111111111111111111111111111111111111' } }
  });

  assert.deepEqual(errors, []);
});
