const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-newsletter-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const newsletter = require('../newsletter');
const { users } = require('../store');

const MONDAY_9AM = Date.parse('2026-10-05T09:00:00Z');
const SECRET = 'newsletter-test-secret';

const LEADS = [
  { ref: 'l1', name: 'Amina', company: 'Vale Robotics', score: 91, followupStatus: 'new', createdAt: '2026-10-03 10:00:00', recommendedNextStep: 'Book a 20-minute discovery call' },
  { ref: 'l2', name: 'Tom', company: 'Birchwood', score: 80, followupStatus: 'won', createdAt: '2026-10-01 10:00:00', followupUpdatedAt: '2026-10-04 10:00:00' },
  { ref: 'l3', name: 'Lee', company: 'Kanu', score: 40, followupStatus: 'new', createdAt: '2026-10-02 10:00:00' },
  { ref: 'old', name: 'Old', company: 'Past', score: 95, followupStatus: 'contacted', createdAt: '2026-09-01 10:00:00', followupUpdatedAt: '2026-09-02 10:00:00' },
];

function build(leads, email = 'jane.doe@example.com', weekKey = newsletter.isoWeekKey(MONDAY_9AM), premium = false) {
  return newsletter.buildNewsletter({
    email,
    activity: newsletter.weeklyActivity(leads, MONDAY_9AM),
    previous: newsletter.weeklyActivity(leads, MONDAY_9AM - 7 * 24 * 3600000),
    premium,
    weekKey,
    dashboardUrl: 'https://app.example/dashboard-v2.html',
    upgradeUrl: 'https://app.example/newsletter-premium.html',
    unsubscribeUrl: 'https://app.example/api/newsletter/unsubscribe?u=1&t=x',
  });
}

test('weekly activity only counts the last seven days', () => {
  const activity = newsletter.weeklyActivity(LEADS, MONDAY_9AM);
  assert.equal(activity.captured, 3);
  assert.equal(activity.strongFit, 2);
  assert.equal(activity.strongFitWaiting, 1);
  assert.equal(activity.won, 1);
  assert.equal(activity.averageScore, 70);
  assert.deepEqual(activity.topLead, { name: 'Amina', company: 'Vale Robotics', score: 91, nextStep: 'Book a 20-minute discovery call' });
});

test('newsletter is personalised with the agent results and a concrete next step', () => {
  const { subject, text } = build(LEADS);
  assert.equal(subject, "Your agent's week: 3 leads captured, 2 strong fits");
  assert.match(text, /^Hi Jane,/);
  assert.match(text, /Captured and scored 3 new leads/);
  assert.match(text, /Top lead: Amina at Vale Robotics \(score 91\)/);
  assert.match(text, /1 deal marked won/);
  assert.match(text, /Reply to your 1 strong-fit lead still waiting/);
  assert.match(text, /Unsubscribe: https:\/\/app\.example\/api\/newsletter\/unsubscribe/);
});

test('newsletter gets straight to value without naming the writing framework', () => {
  for (const weekKey of ['2026-W40', '2026-W41', '2026-W42', '2026-W43']) {
    for (const leads of [LEADS, []]) {
      for (const premium of [false, true]) {
        const { subject, text } = build(leads, 'jane@example.com', weekKey, premium);
        assert.doesNotMatch(`${subject}\n${text}`, /3\s*Es|1\s*C\b|educat|entertain|empath|challeng/i);
      }
    }
  }
});

test('free edition delivers a call list and playbook, then previews premium with real counts', () => {
  const { subject, text } = build(LEADS);
  assert.doesNotMatch(subject, /Premium/);
  assert.match(text, /Who to call first:\n1\. Old at Past \(score 95\)\n2\. Amina at Vale Robotics \(score 91\) - Book a 20-minute discovery call/);
  assert.match(text, /This week's playbook: /);
  assert.match(text, /2 ready-to-send reply drafts for Old and Amina/);
  assert.match(text, /a rescue message for 1 stalled lead/);
  assert.match(text, /\$20\/month, paid in BTC or ETH\. Upgrade: https:\/\/app\.example\/newsletter-premium\.html/);
  assert.doesNotMatch(text, /Ready-to-send replies:|Week over week:/);
});

test('premium edition adds trends, reply drafts and rescue messages without the upsell', () => {
  const { subject, text } = build(LEADS, 'jane@example.com', '2026-W41', true);
  assert.match(subject, /^\[Premium\] /);
  assert.match(text, /Week over week:\n- Leads captured: 3 \(last week 0, \+3\)/);
  assert.match(text, /> To Amina at Vale Robotics:\n  "Hi Amina, thanks for reaching out about Vale Robotics\. The best next step looks like: Book a 20-minute discovery call/);
  assert.match(text, /Stalled-lead rescue:\n> To Old at Past:/);
  assert.doesNotMatch(text, /Upgrade:/);
});

test('lead fields from inbound forms cannot break the email layout', () => {
  const { text } = build([{ ref: 'x', name: 'Eve\r\nBcc: spam@example.com', company: 'Co', score: 90, followupStatus: 'new', createdAt: '2026-10-04 10:00:00' }]);
  assert.match(text, /Eve Bcc: spam@example\.com at Co/);
  assert.doesNotMatch(text, /\nBcc:/);
});

test('quiet weeks still send a reassuring update', () => {
  const { subject, text } = build([], 'x9@example.com');
  assert.equal(subject, "Your agent's week: quiet inbox, steady watch");
  assert.match(text, /^Hi there,/);
  assert.match(text, /no new leads came in/);
});

test('unsubscribe tokens are bound to the user and secret', () => {
  const token = newsletter.unsubscribeToken(7, SECRET);
  assert.equal(newsletter.verifyUnsubscribeToken(7, token, SECRET), true);
  assert.equal(newsletter.verifyUnsubscribeToken(8, token, SECRET), false);
  assert.equal(newsletter.verifyUnsubscribeToken(7, token, 'other'), false);
  assert.equal(newsletter.verifyUnsubscribeToken(7, 'not-hex', SECRET), false);
});

test('scheduler sends once per week to verified, subscribed, opted-in users', async () => {
  const jane = users.create('jane@example.com', 'hash', 'totp');
  const sam = users.create('sam@example.com', 'hash', 'totp');
  users.enableTotp(jane);
  users.enableTotp(sam);
  users.create('unverified@example.com', 'hash', 'totp');
  users.enableTotp(users.create('owner', 'hash', 'totp', 'owner'));

  const sent = [];
  let deliver = async (message) => { sent.push(message); return { sent: true }; };
  const run = (now, isSubscribed = () => true) => newsletter.runWeeklyNewsletters({
    users, leads: { listAll: () => LEADS }, isSubscribed, send: (message) => deliver(message), now, baseUrl: 'https://app.example', secret: SECRET,
  });

  assert.equal((await run(Date.parse('2026-10-05T07:00:00Z'))).status, 'not-due');
  assert.equal((await run(MONDAY_9AM, () => false)).status, 'no-active-subscription');
  assert.equal(sent.length, 0);

  assert.equal((await run(MONDAY_9AM)).sent, 2);
  assert.deepEqual(sent.map((message) => message.to), ['jane@example.com', 'sam@example.com']);
  assert.match(sent[0].unsubscribeUrl, new RegExp(`u=${jane}&t=[0-9a-f]{64}$`));
  assert.match(sent[0].text, /Upgrade: https:\/\/app\.example\/newsletter-premium\.html/);

  users.setNewsletterPremiumUntil(jane, '2026-11-30T00:00:00.000Z');

  const repeat = await run(Date.parse('2026-10-08T12:00:00Z'));
  assert.equal(repeat.sent, 0);
  assert.equal(repeat.skipped, 2);

  const nextWeek = Date.parse('2026-10-12T09:00:00Z');
  deliver = async () => ({ sent: false, reason: 'EMAIL_AUTOREPLY_ENABLED is not true' });
  const failed = await run(nextWeek);
  assert.equal(failed.failed, 2);

  deliver = async (message) => { sent.push(message); return { sent: true }; };
  users.setNewsletterOptOut(sam, true);
  const retried = await run(nextWeek + 3600000);
  assert.equal(retried.sent, 1);
  assert.equal(sent.at(-1).to, 'jane@example.com');
  assert.match(sent.at(-1).subject, /^\[Premium\] /);
});

function routeHandler(app, routePath, method) {
  return app._router.stack.find((layer) => layer.route?.path === routePath && layer.route.methods[method]).route.stack.at(-1).handle;
}

function jsonResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('premium newsletter is prepaid in crypto and activates only after admin approval', () => {
  const app = require('../server');
  const call = (routePath, method, req) => { const res = jsonResponse(); routeHandler(app, routePath, method)(req, res); return res; };
  const buyer = users.create('buyer@example.com', 'hash', 'totp');
  const other = users.create('other@example.com', 'hash', 'totp');
  const admin = users.create('premium-admin', 'hash', 'totp', 'owner');

  const info = call('/api/newsletter/premium', 'get', { session: { userId: buyer } });
  assert.equal(info.body.priceUsd, 20);
  assert.equal(info.body.active, false);
  assert.deepEqual(info.body.methods.map((m) => m.currency), ['BTC', 'ETH']);

  assert.equal(call('/api/newsletter/premium/order', 'post', { body: { method: 'doge' }, session: { userId: buyer } }).statusCode, 400);
  const order = call('/api/newsletter/premium/order', 'post', { body: { method: 'ethereum' }, session: { userId: buyer } }).body;
  assert.equal(order.amountUsd, 20);
  assert.ok(Number(order.amountCrypto) > 0);
  assert.ok(order.walletAddress);

  const txHash = `0x${'a'.repeat(64)}`;
  const confirm = (userId, body) => call('/api/newsletter/premium/confirm', 'post', { body: { reference: order.reference, txHash, amount: order.amountCrypto, ...body }, session: { userId } });
  assert.equal(confirm(other).statusCode, 404);
  assert.equal(confirm(buyer, { txHash: 'nope' }).statusCode, 400);
  assert.equal(confirm(buyer, { amount: Number(order.amountCrypto) / 2 }).statusCode, 400);
  assert.equal(confirm(buyer).statusCode, 202);
  assert.equal(confirm(buyer).statusCode, 409);
  assert.equal(newsletter.isPremium(users.findById(buyer).newsletter_premium_until), false);

  const pending = call('/api/newsletter/premium/pending', 'get', { session: { userId: admin } }).body.payments;
  assert.deepEqual(pending.map((p) => p.reference), [order.reference]);

  const review = call('/api/newsletter/premium/review/:reference', 'post', { params: { reference: order.reference }, body: { approved: true }, session: { userId: admin } });
  assert.equal(review.body.status, 'confirmed');
  const until = Date.parse(users.findById(buyer).newsletter_premium_until);
  assert.ok(until > Date.now() + 27 * 24 * 3600000 && until < Date.now() + 32 * 24 * 3600000);
  assert.equal(call('/api/newsletter/premium/review/:reference', 'post', { params: { reference: order.reference }, body: { approved: true }, session: { userId: admin } }).statusCode, 404);
});

test('unsubscribe link confirms on GET and opts out on POST', () => {
  const app = require('../server');
  const { config } = require('../config');
  const handler = (method) => app._router.stack
    .find((layer) => layer.route?.path === '/api/newsletter/unsubscribe' && layer.route.methods[method]).route.stack.at(-1).handle;
  const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, type() { return this; }, send(body) { this.body = body; return this; } });

  const userId = users.create('leaver@example.com', 'hash', 'totp');
  users.enableTotp(userId);
  const token = newsletter.unsubscribeToken(userId, config.sessionSecret);

  const bad = response();
  handler('get')({ query: { u: String(userId), t: '0'.repeat(64) } }, bad);
  assert.equal(bad.statusCode, 400);

  const confirm = response();
  handler('get')({ query: { u: String(userId), t: token } }, confirm);
  assert.match(confirm.body, /<form method="post"/);
  assert.ok(users.listNewsletterRecipients().some((user) => user.id === userId));

  const done = response();
  handler('post')({ query: { u: String(userId), t: token } }, done);
  assert.equal(done.statusCode, 200);
  assert.ok(!users.listNewsletterRecipients().some((user) => user.id === userId));
});
