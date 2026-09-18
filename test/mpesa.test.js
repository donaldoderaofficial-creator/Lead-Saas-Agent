const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MPESA_CONSUMER_KEY = 'test-consumer-key';
process.env.MPESA_CONSUMER_SECRET = 'test-consumer-secret';
process.env.MPESA_SHORT_CODE = '174379';
process.env.MPESA_PASSKEY = 'test-passkey';
process.env.MPESA_ENV = 'sandbox';
process.env.MPESA_CALLBACK_URL = 'https://api.example.test/payments/mpesa/callback';

let stkRequest;
globalThis.fetch = async (url, options = {}) => {
  if (url.endsWith('/oauth/v1/generate?grant_type=client_credentials')) {
    return { ok: true, json: async () => ({ access_token: 'test-token' }) };
  }
  stkRequest = { url, options };
  return {
    ok: true,
    json: async () => ({ CheckoutRequestID: 'request-1', CustomerMessage: 'Success' }),
  };
};

const { initiateSTKPush, normalizePhoneNumber } = require('../mpesa-client');

test('normalizes Kenyan phone numbers for STK prompts', () => {
  assert.equal(normalizePhoneNumber('0712 345 678'), '254712345678');
  assert.equal(normalizePhoneNumber('+254712345678'), '254712345678');
  assert.equal(normalizePhoneNumber('254112345678'), '254112345678');
});

test('sends the client phone to Safaricom for an STK prompt', async () => {
  await initiateSTKPush({
    phone: '0712 345 678',
    amount: 250,
    accountReference: 'ORDER-123',
    description: 'Dispatch Pro lead report',
  });

  const request = JSON.parse(stkRequest.options.body);
  assert.equal(request.PartyA, '254712345678');
  assert.equal(request.PhoneNumber, '254712345678');
  assert.notEqual(request.PartyA, 'https://dispatch-lead-agent.netlify.app');
});
