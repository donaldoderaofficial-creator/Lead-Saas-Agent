const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { calculateCommission } = require('../sales-commission');
const dbPath = path.join(os.tmpdir(), `lead-agent-sales-agents-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.PORT = '3212';
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-sales-agent-session-secret';
process.env.PAYPAL_PLAN_STARTER_MONTHLY = 'P-STARTER-TEST';
process.env.PAYPAL_PLAN_GROWTH_MONTHLY = 'P-GROWTH-TEST';

const { pendingLeads, salesAgents, users } = require('../store');
const paypalClient = require('../paypal-client');
paypalClient.verifyWebhookSignature = async () => true;
const app = require('../server');

function routeHandler(routePath) {
  const layer = app._router.stack.find((item) => item.route?.path === routePath);
  assert.ok(layer, `route ${routePath} should exist`);
  return layer.route.stack.at(-1).handle;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createAgent(email) {
  const id = users.create(email, 'test-hash', 'test-totp-secret', 'sales_agent');
  return { id, ...salesAgents.findById(id) };
}

test('calculates 20% commission in BTC and ETH precision', () => {
  assert.equal(calculateCommission(0.00123456, 'BTC'), 0.00024691);
  assert.equal(calculateCommission(0.01234567, 'ETH'), 0.00246913);
});

test('rejects invalid commission amounts, currencies, and rates', () => {
  assert.throws(() => calculateCommission(0, 'USD'));
  assert.throws(() => calculateCommission(-1, 'USD'));
  assert.throws(() => calculateCommission(1, ''));
  assert.throws(() => calculateCommission(1, 'USD'), /currency must be BTC or ETH/);
  assert.throws(() => calculateCommission(1, 'USD', 2));
});

test('only records matching Bitcoin and Ethereum subscription commissions', () => {
  const agent = createAgent('crypto-only-commission@example.com');
  assert.throws(() => salesAgents.recordCommission({
    salesAgentUserId: agent.id,
    provider: 'paypal-subscription',
    transactionId: 'PAYPAL-NO-COMMISSION',
    reference: 'PAYPAL-ORDER',
    amount: 79,
    currency: 'BTC',
    rate: 0.2,
  }), /only supported for matching BTC or ETH/);
  assert.throws(() => salesAgents.recordCommission({
    salesAgentUserId: agent.id,
    provider: 'bitcoin-subscription',
    transactionId: 'BTC-WRONG-CURRENCY',
    reference: 'BTC-ORDER',
    amount: 1,
    currency: 'USD',
    rate: 0.2,
  }), /only supported for matching BTC or ETH/);
});

test('creates agent referral orders only for valid buyer email addresses', () => {
  const agent = createAgent('agent-order@example.com');
  const createOrder = routeHandler('/api/billing/crypto/order');
  const accepted = response();
  createOrder({ body: {
    plan: 'starter',
    method: 'bitcoin',
    name: 'Buyer',
    email: 'buyer@example.com',
    referral: agent.referralCode,
  } }, accepted);

  assert.equal(accepted.statusCode, 200);
  assert.equal(pendingLeads.get(accepted.body.reference).referralSource, agent.referralCode);

  const rejected = response();
  createOrder({ body: { plan: 'starter', method: 'bitcoin', email: '', referral: agent.referralCode } }, rejected);
  assert.equal(rejected.statusCode, 400);
});

test('credits only directly referred BTC and ETH sales after approval', () => {
  const firstAgent = createAgent('first-agent@example.com');
  const secondAgent = createAgent('second-agent@example.com');
  const adminId = users.create('commission-admin@example.com', 'test-hash', 'test-totp-secret', 'admin');
  const createOrder = routeHandler('/api/billing/crypto/order');
  const confirmPayment = routeHandler('/api/billing/crypto/confirm');
  const reviewPayment = routeHandler('/api/billing/crypto/review/:reference');

  const submitOrder = (referral, transactionId, method = 'bitcoin') => {
    const orderResponse = response();
    createOrder({ body: {
      plan: 'starter',
      method,
      name: 'Referred customer',
      email: 'referred-customer@example.com',
      referral,
    } }, orderResponse);
    assert.equal(orderResponse.statusCode, 200);
    const order = pendingLeads.get(orderResponse.body.reference);
    const confirmResponse = response();
    confirmPayment({ body: {
      reference: orderResponse.body.reference,
      txHash: transactionId,
      method,
      plan: 'starter',
      amount: order.amountCrypto,
    } }, confirmResponse);
    assert.equal(confirmResponse.statusCode, 202);
    return { reference: orderResponse.body.reference, amount: Number(order.amountCrypto) };
  };

  const first = submitOrder(firstAgent.referralCode, 'CRYPTO-COMMISSION-1');
  assert.equal(salesAgents.listCommissions(firstAgent.id).length, 0);
  const firstReview = response();
  reviewPayment({ params: { reference: first.reference }, body: { approved: true }, session: { userId: adminId, username: 'admin' } }, firstReview);
  assert.equal(firstReview.body.status, 'confirmed');
  const firstCommissions = salesAgents.listCommissions(firstAgent.id);
  assert.equal(firstCommissions.length, 1);
  assert.equal(firstCommissions[0].commissionAmount, calculateCommission(first.amount, 'BTC'));
  assert.equal(firstCommissions[0].status, 'pending');

  const second = submitOrder(secondAgent.referralCode, 'CRYPTO-COMMISSION-2', 'ethereum');
  const secondReview = response();
  reviewPayment({ params: { reference: second.reference }, body: { approved: true }, session: { userId: adminId, username: 'admin' } }, secondReview);
  assert.equal(salesAgents.listCommissions(firstAgent.id).length, 1);
  assert.equal(salesAgents.listCommissions(secondAgent.id).length, 1);
  assert.equal(salesAgents.listCommissions(secondAgent.id)[0].currency, 'ETH');

  const renewal = submitOrder(null, 'CRYPTO-UNATTRIBUTED-RENEWAL');
  const renewalReview = response();
  reviewPayment({ params: { reference: renewal.reference }, body: { approved: true }, session: { userId: adminId, username: 'admin' } }, renewalReview);
  assert.equal(salesAgents.listCommissions(firstAgent.id).length, 1);
  assert.equal(salesAgents.listCommissions(secondAgent.id).length, 1);

  const payout = routeHandler('/api/admin/sales-agents/commissions/:id/payout');
  const payoutResponse = response();
  payout({
    params: { id: String(firstCommissions[0].id) },
    body: { payoutReference: 'payout-receipt-1' },
    session: { userId: adminId },
  }, payoutResponse);
  assert.equal(payoutResponse.body.status, 'paid');
  assert.equal(salesAgents.listCommissions(firstAgent.id)[0].status, 'paid');
  assert.equal(salesAgents.markCommissionPaid(firstCommissions[0].id, 'duplicate', adminId), false);
});

test('never credits PayPal payments with sales-agent commissions', async () => {
  const agent = createAgent('paypal-agent@example.com');
  const webhook = routeHandler('/payments/paypal/webhook');
  const subscriptionId = 'I-AGENT-TEST-1';
  const saleEvent = (id, createTime) => ({
    event_type: 'PAYMENT.SALE.COMPLETED',
    resource: {
      id,
      billing_agreement_id: subscriptionId,
      amount: { total: '79.00', currency: 'USD' },
      create_time: createTime,
    },
  });

  await webhook({ headers: {}, body: saleEvent('PAYPAL-SALE-1', '2026-03-01T10:00:00.000Z') }, response());
  assert.equal(salesAgents.listCommissions(agent.id).length, 0);

  await webhook({ headers: {}, body: {
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resource: {
      id: subscriptionId,
      plan_id: 'P-STARTER-TEST',
      custom_id: agent.referralCode,
      create_time: '2026-03-01T09:00:00.000Z',
      billing_info: { last_payment: { time: '2026-03-01T10:00:00.000Z', amount: { value: '79.00' } } },
    },
  } }, response());

  assert.equal(salesAgents.listCommissions(agent.id).length, 0);

  await webhook({ headers: {}, body: saleEvent('PAYPAL-SALE-1', '2026-03-01T10:00:00.000Z') }, response());
  await webhook({ headers: {}, body: saleEvent('PAYPAL-SALE-2', '2026-04-01T10:00:00.000Z') }, response());
  await webhook({ headers: {}, body: saleEvent('PAYPAL-SALE-3', '2027-03-02T10:00:00.000Z') }, response());

  assert.equal(salesAgents.listCommissions(agent.id).length, 0);
});

test('returns an agent-only referral link and currency-separated earnings', () => {
  const agent = createAgent('earnings-agent@example.com');
  salesAgents.recordCommission({
    salesAgentUserId: agent.id,
    provider: 'bitcoin-subscription',
    transactionId: 'EARNINGS-BTC-1',
    reference: 'EARNINGS-ORDER-1',
    amount: 0.001,
    currency: 'BTC',
    rate: 0.2,
  });
  const earnings = routeHandler('/api/sales-agent/earnings');
  const result = response();
  earnings({ session: { userId: agent.id } }, result);

  assert.equal(result.body.referralCode, agent.referralCode);
  assert.match(result.body.referralUrl, new RegExp(`ref=${agent.referralCode}`));
  assert.equal(result.body.totals.BTC.pending, 0.0002);
  assert.equal(result.body.totals.BTC.paid, 0);
});

test('prevents account registration from selecting privileged roles', async () => {
  const register = routeHandler('/auth/register');
  const result = response();
  await register({ body: {
    email: 'untrusted-role@example.com',
    password: 'StrongPass123!',
    accountType: 'admin',
  } }, result);

  assert.equal(result.statusCode, 400);
});

test('keeps billing, registration, and agent-page inline scripts syntactically valid', () => {
  const files = [
    '../public/billing.html',
    '../netlify-static/billing.html',
    '../public/dashboard-v2.html',
    '../public/sales-agent.html',
  ];
  for (const relativePath of files) {
    const filePath = path.join(__dirname, relativePath);
    const html = fs.readFileSync(filePath, 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((script) => script.trim());
    for (const script of scripts) {
      assert.doesNotThrow(() => new vm.Script(script, { filename: filePath }), filePath);
    }
  }
});
