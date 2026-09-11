const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MPESA_CONSUMER_KEY = 'test-consumer-key';
process.env.MPESA_CONSUMER_SECRET = 'test-consumer-secret';
process.env.MPESA_SHORT_CODE = '174379';
process.env.MPESA_ENV = 'sandbox';

let qrRequest;
globalThis.fetch = async (url, options = {}) => {
  if (url.endsWith('/oauth/v1/generate?grant_type=client_credentials')) {
    return { ok: true, json: async () => ({ access_token: 'test-token' }) };
  }
  qrRequest = { url, options };
  return {
    ok: true,
    json: async () => ({ ResponseCode: '00', RequestID: 'request-1', QRCode: 'base64-qr' }),
  };
};

const { generateDynamicQrCode, initiateSTKPush, normalizePhoneNumber } = require('../mpesa-client');

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

  const request = JSON.parse(qrRequest.options.body);
  assert.equal(request.PartyA, '254712345678');
  assert.equal(request.PhoneNumber, '254712345678');
  assert.notEqual(request.PartyA, 'https://dispatch-lead-agent.netlify.app');
});

test('generates a dynamic M-Pesa QR request', async () => {
  const result = await generateDynamicQrCode({
    merchantName: 'Dispatch Pro',
    reference: 'ORDER-123',
    amount: 250,
    transactionCode: 'PB',
  });

  assert.equal(result.QRCode, 'base64-qr');
  assert.equal(qrRequest.url, 'https://sandbox.safaricom.co.ke/mpesa/qrcode/v1/generate');
  assert.equal(qrRequest.options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(qrRequest.options.body), {
    MerchantName: 'Dispatch Pro',
    RefNo: 'ORDER-123',
    Amount: 250,
    TrxCode: 'PB',
    CPI: '174379',
    Size: '300',
  });
});

test('rejects invalid dynamic QR amounts before making a request', async () => {
  await assert.rejects(
    generateDynamicQrCode({
      merchantName: 'Dispatch Pro',
      reference: 'ORDER-123',
      amount: 0,
      transactionCode: 'PB',
    }),
    /amount must be a positive integer/
  );
});
