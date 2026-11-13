const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const loyalty = require('../loyalty');

const dbPath = path.join(os.tmpdir(), `lead-agent-loyalty-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.PORT = '3213';
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-loyalty-session-secret';
process.env.BITCOIN_WALLET_ADDRESS = 'bc1qloyaltytest';
process.env.ETHEREUM_WALLET_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const { customerLoyalty, payments, pendingLeads, users } = require('../store');
const app = require('../server');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function callRoute(routePath, method, request) {
  const layer = app._router.stack.find((item) => item.route?.path === routePath && item.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${routePath} should exist`);
  const result = response();
  layer.route.stack.at(-1).handle(request, result);
  return result;
}

test('awards one point per complete five dollars of subscription value', () => {
  assert.equal(loyalty.pointsForSubscription(79), 15);
  assert.equal(loyalty.pointsForSubscription(249), 49);
  assert.equal(loyalty.pointsForSubscription(4.99), 0);
});

test('rejects invalid subscription values instead of minting points', () => {
  for (const amount of [0, -5, Infinity, NaN, 'not-money']) {
    assert.throws(() => loyalty.pointsForSubscription(amount), /positive finite amount/);
  }
});

test('exchanges points only in fixed $5 subscription credit increments', () => {
  assert.deepEqual(loyalty.SUBSCRIPTION_CREDIT, {
    points: 100,
    usd: 5,
  });
  assert.equal(loyalty.creditForPoints(0), 0);
  assert.equal(loyalty.creditForPoints(200), 10);
  assert.throws(() => loyalty.creditForPoints(99), /multiple of 100/);
  assert.throws(() => loyalty.creditForPoints(-100), /multiple of 100/);
});

test('reserves, releases, and consumes subscription points around verified payments', () => {
  const buyerEmail = 'loyalty-customer@example.com';
  const buyerId = users.create(buyerEmail, 'hash', 'totp');
  const adminId = users.create('loyalty-admin@example.com', 'hash', 'totp', 'admin');

  const buy = (plan, points = 0) => {
    const orderResponse = callRoute('/api/billing/crypto/order', 'post', {
      body: { plan, method: 'bitcoin', email: buyerEmail, loyaltyPointsToRedeem: points },
      session: points ? { userId: buyerId } : {},
    });
    assert.equal(orderResponse.statusCode, 200);
    const order = orderResponse.body;
    assert.equal(pendingLeads.get(order.reference).amountUsd, order.amountUsd);
    return order;
  };
  const submit = (order, transactionId) => {
    const confirmation = callRoute('/api/billing/crypto/confirm', 'post', {
      body: {
        reference: order.reference,
        txHash: transactionId,
        method: 'bitcoin',
        plan: order.plan,
        amount: order.amountCrypto,
      },
    });
    assert.equal(confirmation.statusCode, 202);
  };
  const review = (order, approved) => callRoute('/api/billing/crypto/review/:reference', 'post', {
    params: { reference: order.reference },
    body: { approved },
    session: { userId: adminId },
  });

  for (let index = 1; index <= 3; index += 1) {
    const order = buy('growth');
    submit(order, `LOYALTY-EARN-${index}`);
    assert.equal(review(order, true).body.loyaltyPointsEarned, 49);
  }
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 147);

  const unauthenticated = callRoute('/api/billing/crypto/order', 'post', {
    body: { plan: 'starter', method: 'bitcoin', email: buyerEmail, loyaltyPointsToRedeem: 100 },
    session: {},
  });
  assert.equal(unauthenticated.statusCode, 401);
  const otherId = users.create('another-customer@example.com', 'hash', 'totp');
  const mismatchedEmail = callRoute('/api/billing/crypto/order', 'post', {
    body: { plan: 'starter', method: 'bitcoin', email: buyerEmail, loyaltyPointsToRedeem: 100 },
    session: { userId: otherId },
  });
  assert.equal(mismatchedEmail.statusCode, 403);

  const cancelledOrder = buy('starter', 100);
  assert.equal(cancelledOrder.amountUsd, 74);
  const standardAmount = Number(app.buildSubscriptionCheckoutPayload({ plan: 'starter', method: 'bitcoin' }).amountCrypto);
  assert.equal(Number(cancelledOrder.amountCrypto), Number((standardAmount * 74 / 79).toFixed(8)));
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 47);
  const secondReservation = callRoute('/api/billing/crypto/order', 'post', {
    body: { plan: 'starter', method: 'bitcoin', email: buyerEmail, loyaltyPointsToRedeem: 100 },
    session: { userId: buyerId },
  });
  assert.equal(secondReservation.statusCode, 409);
  const otherAccountCancel = callRoute('/api/billing/crypto/order/:reference/cancel', 'post', {
    params: { reference: cancelledOrder.reference },
    session: { userId: otherId },
  });
  assert.equal(otherAccountCancel.statusCode, 404);
  const cancelled = callRoute('/api/billing/crypto/order/:reference/cancel', 'post', {
    params: { reference: cancelledOrder.reference },
    session: { userId: buyerId },
  });
  assert.equal(cancelled.body.pointsReleased, 100);
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 147);

  const discountedOrder = buy('starter', 100);
  submit(discountedOrder, 'LOYALTY-REDEEM-1');
  assert.equal(payments.findByReference(discountedOrder.reference, 'bitcoin-subscription').raw.loyaltyDiscountUsd, 5);
  const cannotCancelSubmitted = callRoute('/api/billing/crypto/order/:reference/cancel', 'post', {
    params: { reference: discountedOrder.reference },
    session: { userId: buyerId },
  });
  assert.equal(cannotCancelSubmitted.statusCode, 409);

  const approval = review(discountedOrder, true);
  assert.equal(approval.body.loyaltyPointsRedeemed, 100);
  assert.equal(approval.body.loyaltyPointsEarned, 14);
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 61);
  assert.equal(review(discountedOrder, true).statusCode, 404);
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 61);

  const nextPurchase = buy('growth');
  submit(nextPurchase, 'LOYALTY-EARN-4');
  review(nextPurchase, true);
  const rejectedOrder = buy('starter', 100);
  submit(rejectedOrder, 'LOYALTY-REJECT-1');
  assert.equal(review(rejectedOrder, false).body.status, 'rejected');
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 110);
  assert.equal(pendingLeads.has(rejectedOrder.reference), false);

  const insufficient = callRoute('/api/billing/crypto/order', 'post', {
    body: { plan: 'starter', method: 'bitcoin', email: buyerEmail, loyaltyPointsToRedeem: 200 },
    session: { userId: buyerId },
  });
  assert.equal(insufficient.statusCode, 409);
  assert.equal(customerLoyalty.getAccount(buyerId).balance, 110);

  const account = callRoute('/api/loyalty/me', 'get', { session: { userId: buyerId } });
  assert.equal(account.body.balance, 110);
  assert.equal(account.body.pointsUntilCredit, 90);

  const agentId = users.create('loyalty-agent@example.com', 'hash', 'totp', 'sales_agent');
  const agentOrder = callRoute('/api/billing/crypto/order', 'post', {
    body: { plan: 'starter', method: 'bitcoin', email: 'loyalty-agent@example.com' },
    session: {},
  }).body;
  submit(agentOrder, 'LOYALTY-NON-CUSTOMER');
  review(agentOrder, true);
  assert.equal(customerLoyalty.getAccount(agentId).balance, 0);
});
