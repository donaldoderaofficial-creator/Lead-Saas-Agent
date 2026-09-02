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
process.env.BITCOIN_WALLET_ADDRESS = 'bc1qwalletbitcoinaddress';
process.env.ETHEREUM_WALLET_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const { config } = require('../config');
const { payments } = require('../store');
const { hasActiveSubscription } = require('../subscription-policy');

test('requires an active paid package before service access', () => {
  assert.equal(hasActiveSubscription({ plan: 'none', status: 'inactive' }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'cancelled' }), false);
  assert.equal(hasActiveSubscription({ plan: 'starter', status: 'active' }), true);
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

test('allows repeated ebook report writes without finalized statement errors', () => {
  const { completedReports } = require('../store');

  const first = {
    type: 'ebook',
    title: "The Builder's Blueprint",
    buyer: { name: 'Writer', email: 'writer@example.com' },
    amountUsd: 19.99,
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

  assert.equal(payload.amountUsd, 19.99);
  assert.equal(payload.walletAddress, 'bc1qwalletbitcoinaddress');
  assert.match(payload.instructions, /copy/i);
  assert.match(payload.instructions, /3EiZ7FZ5r8LB9rdKWmhei5MsErPj58dK3k|bc1qwalletbitcoinaddress/);
});