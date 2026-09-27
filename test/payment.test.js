const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-payments-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.PORT = '3210';
process.env.DB_PATH = dbPath;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';
process.env.BITCOIN_WALLET_ADDRESS = 'bc1qwalletbitcoinaddress';
process.env.ETHEREUM_WALLET_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
process.env.MPESA_SHORT_CODE = process.env.MPESA_SHORT_CODE || '174379';

const { config } = require('../config');
const { payments, pendingLeads, subscription } = require('../store');
const { hasActiveSubscription, paidThrough } = require('../subscription-policy');

function mockResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function routeHandler(app, routePath) {
  return app._router.stack.find((layer) => layer.route?.path === routePath).route.stack.at(-1).handle;
}

test('requires an active paid package before service access', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(hasActiveSubscription({ plan: 'none', status: 'inactive' }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'cancelled', currentPeriodEnd: future }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'active', currentPeriodEnd: future }), true);
});

test('never grants service on credit: no trials, approvals, open-ended, or lapsed periods', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'trialing', currentPeriodEnd: future }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'approved', currentPeriodEnd: future }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'pending_payment', currentPeriodEnd: future }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'past_due', currentPeriodEnd: future }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'active', currentPeriodEnd: null }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'active', currentPeriodEnd: past }), false);
});

test('paid period covers one month per payment and ignores duplicate payment events', () => {
  const paidAt = Date.parse('2026-01-15T00:00:00Z');
  const first = paidThrough(null, paidAt);
  assert.equal(first, '2026-02-15T00:00:00.000Z');
  assert.equal(paidThrough(first, paidAt), first);
  assert.equal(paidThrough(first, Date.parse(first)), '2026-03-15T00:00:00.000Z');
});

test('withholds lead reports when the payment is below the full price', async () => {
  const app = require('../server');
  const { completedReports } = require('../store');
  const reference = 'c2b-underpaid-test';
  pendingLeads.set(reference, { name: 'Short Payer', email: 'short@example.com' });
  const confirm = routeHandler(app, '/payments/mpesa/c2b/confirmation');

  await confirm({ body: {
    BusinessShortCode: config.payment.mpesa.shortCode,
    TransID: 'UNDERPAY-1',
    BillRefNumber: reference,
    TransAmount: Number(config.pricing.kes.starter.price) - 1,
  } }, mockResponse());

  assert.equal(payments.findByReference(reference, 'mpesa-c2b').status, 'underpaid');
  assert.equal(completedReports.has(reference), false);
  assert.equal(pendingLeads.has(reference), true);
});

test('rejects M-Pesa C2B payments for unknown references or short amounts before charging', () => {
  const app = require('../server');
  const validate = routeHandler(app, '/payments/mpesa/c2b/validation');
  const reference = 'c2b-validation-test';
  pendingLeads.set(reference, { name: 'Payer', email: 'payer@example.com' });
  const price = Number(config.pricing.kes.starter.price);

  const unknown = mockResponse();
  validate({ body: { BillRefNumber: 'nope', TransAmount: price } }, unknown);
  assert.equal(unknown.body.ResultCode, 'C2B00012');

  const short = mockResponse();
  validate({ body: { BillRefNumber: reference, TransAmount: price - 1 } }, short);
  assert.equal(short.body.ResultCode, 'C2B00013');

  const full = mockResponse();
  validate({ body: { BillRefNumber: reference, TransAmount: price } }, full);
  assert.equal(full.body.ResultCode, 0);
});

test('ignores M-Pesa STK callbacks that Safaricom does not confirm', async () => {
  const app = require('../server');
  const mpesaClient = require('../mpesa-client');
  const { completedReports } = require('../store');
  const reference = 'ws_CO_forged_callback';
  pendingLeads.set(reference, { name: 'Forger', email: 'forger@example.com' });
  const original = mpesaClient.querySTKPush;
  mpesaClient.querySTKPush = async () => ({ ResultCode: '1032', ResultDesc: 'Request cancelled by user' });
  try {
    const callback = routeHandler(app, '/payments/mpesa/callback');
    await callback({ body: { Body: { stkCallback: {
      ResultCode: 0,
      CheckoutRequestID: reference,
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: Number(config.pricing.kes.starter.price) }, { Name: 'MpesaReceiptNumber', Value: 'FORGED1' }] },
    } } } }, mockResponse());
  } finally {
    mpesaClient.querySTKPush = original;
  }

  assert.equal(completedReports.has(reference), false);
});

test('records each provider payment once', () => {
  const payment = {
    provider: 'mpesa-c2b',
    transactionId: 'QRCPT-001',
    reference: 'ORDER-123',
    amount: 250,
    currency: 'KES',
    raw: { TransID: 'QRCPT-001' },
  };

  assert.equal(payments.record(payment), true);
  assert.equal(payments.record(payment), false);
});

test('exposes direct bitcoin and ethereum wallet payment options', () => {
  assert.equal(config.wallets.bitcoin.enabled, true);
  assert.equal(config.wallets.ethereum.enabled, true);
  assert.equal(config.wallets.bitcoin.address, 'bc1qwalletbitcoinaddress');
  assert.equal(config.wallets.ethereum.address, '0x1234567890abcdef1234567890abcdef12345678');
});

test('permanently advertises all payment methods and currencies', () => {
  const app = require('../server');
  const optionsRoute = app._router.stack.find((layer) => layer.route?.path === '/api/payments/options');
  const options = optionsRoute.route.stack.at(-1).handle;
  const response = { body: null, json(body) { this.body = body; return this; } };

  options({}, response);

  assert.deepEqual(response.body.providers.paypal.methods, ['checkout']);
  assert.deepEqual(response.body.providers.mpesa.methods, ['stk-push']);
  assert.deepEqual(response.body.providers.bitcoin.methods, ['wallet-transfer']);
  assert.deepEqual(response.body.providers.ethereum.methods, ['wallet-transfer']);
  assert.deepEqual(response.body.supportedCurrencies, ['USD', 'KES', 'BTC', 'ETH']);
});

test('health response exposes a release build identifier', () => {
  const app = require('../server');
  const healthRoute = app._router.stack.find((layer) => layer.route?.path === '/health');
  const health = healthRoute.route.stack.at(-1).handle;
  const response = { body: null, json(body) { this.body = body; return this; } };

  health({}, response);

  assert.equal(response.body.release.build, 'local');
});

test('stores validated AI referral attribution on subscription orders', () => {
  const app = require('../server');
  const orderRoute = app._router.stack.find((layer) => layer.route?.path === '/api/billing/crypto/order');
  const order = orderRoute.route.stack.at(-1).handle;
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

  order({ body: { plan: 'starter', method: 'bitcoin', referral: 'Partner-Agent_7' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(pendingLeads.get(response.body.reference).referralSource, 'partner-agent_7');

  const invalidResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  order({ body: { plan: 'starter', method: 'bitcoin', referral: 'https://bad.example/?secret=1' } }, invalidResponse);
  assert.equal(pendingLeads.get(invalidResponse.body.reference).referralSource || null, null);
});

test('does not attempt unconfigured PayPal checkout', () => {
  const app = require('../server');
  const leadRoute = app._router.stack.find((layer) => layer.route?.path === '/api/lead');
  const lead = leadRoute.route.stack.at(-1).handle;
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

  lead({ body: { name: 'Customer', email: 'customer@example.com', method: 'paypal' } }, response);

  assert.equal(response.statusCode, 503);
  assert.match(response.body.error, /not configured/i);
});

test('uses the required bitcoin amounts for starter and growth subscription packages', () => {
  const { buildSubscriptionCheckoutPayload } = require('../server');

  const starter = buildSubscriptionCheckoutPayload({ plan: 'starter', method: 'bitcoin' });
  const growth = buildSubscriptionCheckoutPayload({ plan: 'growth', method: 'bitcoin' });

  assert.equal(starter.amountCrypto, '0.0010327');
  assert.equal(growth.amountCrypto, '0.00325');
});

test('uses the required ethereum amounts for starter and growth subscription packages', () => {
  const { buildSubscriptionCheckoutPayload } = require('../server');

  const starter = buildSubscriptionCheckoutPayload({ plan: 'starter', method: 'ethereum' });
  const growth = buildSubscriptionCheckoutPayload({ plan: 'growth', method: 'ethereum' });

  assert.equal(starter.amountCrypto, '0.03238');
  assert.equal(growth.amountCrypto, '0.10206');
});

test('crypto subscription proof does not activate access until admin approval', () => {
  const app = require('../server');
  const reference = 'crypto-subscription-review-test';
  pendingLeads.set(reference, { name: 'Subscriber', email: 'subscriber@example.com', product: 'subscription', paymentMethod: 'ethereum', plan: 'starter', amountCrypto: '0.002854' });

  const confirmRoute = app._router.stack.find((layer) => layer.route?.path === '/api/billing/crypto/confirm');
  const confirm = confirmRoute.route.stack.at(-1).handle;
  const pendingResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  confirm({ body: { reference, txHash: '0xcrypto-proof', method: 'ethereum', plan: 'starter', amount: 0.002854 } }, pendingResponse);

  assert.equal(pendingResponse.statusCode, 202);
  assert.equal(hasActiveSubscription(subscription.get()), false);
  assert.equal(payments.findByReference(reference, 'ethereum-subscription').status, 'pending_review');

  const reviewRoute = app._router.stack.find((layer) => layer.route?.path === '/api/billing/crypto/review/:reference');
  const review = reviewRoute.route.stack.at(-1).handle;
  const approvedResponse = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  review({ params: { reference }, body: { approved: true }, session: { username: 'admin' } }, approvedResponse);

  assert.equal(approvedResponse.body.status, 'confirmed');
  assert.equal(subscription.get().billingType, 'crypto');
  assert.equal(hasActiveSubscription(subscription.get()), true);
  const paidUntil = Date.parse(subscription.get().currentPeriodEnd);
  assert.ok(paidUntil > Date.now() + 27 * 86400000 && paidUntil < Date.now() + 32 * 86400000);
});

test('allows repeated ebook report writes without finalized statement errors', () => {
  const { completedReports } = require('../store');

  const first = {
    type: 'ebook',
    title: "The Builder's Blueprint",
    buyer: { name: 'Writer', email: 'writer@example.com' },
      amountUsd: 9.99,
    purchasedAt: new Date().toISOString(),
  };

  const second = {
    ...first,
    buyer: { name: 'Writer 2', email: 'writer2@example.com' },
    purchasedAt: new Date().toISOString(),
  };

  completedReports.set('ebook-repeat-test-1', first);
  completedReports.set('ebook-repeat-test-2', second);

  assert.equal(completedReports.has('ebook-repeat-test-1'), true);
  assert.equal(completedReports.has('ebook-repeat-test-2'), true);
});

test('allows ebook payment origins for buyer checkout', () => {
  const app = require('../server');

  assert.equal(app.isOriginAllowed('http://localhost:5173', '/api/ebook/order'), true);
  assert.equal(app.isOriginAllowed('http://localhost:3000', '/api/ebook/confirm'), true);
  assert.equal(app.isOriginAllowed('https://evil.example', '/api/ebook/order'), false);
});

test('allows the deployed billing page to load wallet payment options', () => {
  const app = require('../server');

  assert.equal(app.isOriginAllowed('https://lead-saas-agent.netlify.app', '/api/payments/options'), true);
  assert.equal(app.isOriginAllowed('https://lead-saas-agent.netlify.app', '/api/billing/crypto/order'), true);
});

test('accepts a deposit screenshot as ebook payment confirmation', () => {
  const app = require('../server');
  const { pendingLeads, completedReports } = require('../store');

  const reference = 'ebook-screenshot-confirmation';
  pendingLeads.set(reference, {
    name: 'Image Buyer',
    email: 'image@example.com',
    paymentMethod: 'bitcoin-ebook',
    product: 'ebook',
  });

  const response = {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.jsonBody = payload;
      return this;
    },
  };

  const req = { body: { reference, screenshotData: 'data:image/png;base64,abc123', name: 'Image Buyer' } };
  const res = response;

  app._router ? null : null;
  const route = app._router.stack.find((layer) => layer.route && layer.route.path === '/api/ebook/confirm');
  const handler = route.route.stack[0].handle;

  assert.equal(typeof handler, 'function');

  handler(req, res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.jsonBody.status, 'pending_review');
  assert.equal(completedReports.has(reference), false);
});

test('redirects legacy ebook links to the current live ebook page', async () => {
  const app = require('../server');
  const server = app.listen(0);

  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${port}/ebook-success.html`, { redirect: 'manual' }),
      fetch(`http://127.0.0.1:${port}/ebook-reader.html`, { redirect: 'manual' }),
      fetch(`http://127.0.0.1:${port}/ebook/access`, { redirect: 'manual' }),
      fetch(`http://127.0.0.1:${port}/ebook/download.pdf`, { redirect: 'manual' }),
    ]);

    const locations = responses.map((response) => response.headers.get('location'));

    assert.equal(responses[0].status, 302);
    assert.equal(locations[0], '/ebook.html');
    assert.equal(locations[1], '/ebook.html');
    assert.equal(locations[2], '/ebook.html');
    assert.equal(locations[3], '/ebook.html');
  } finally {
    server.close();
  }
});

test('builds a simple wallet-only ebook checkout payload without email friction', () => {
  const { buildEbookCheckoutPayload } = require('../server');

  const payload = buildEbookCheckoutPayload({ name: 'Simple Buyer' });

  assert.equal(payload.amountUsd, 9.99);
  assert.equal(payload.walletAddress, 'bc1qwalletbitcoinaddress');
  assert.match(payload.instructions, /copy/i);
  assert.match(payload.instructions, /3EiZ7FZ5r8LB9rdKWmhei5MsErPj58dK3k|bc1qwalletbitcoinaddress/);
});