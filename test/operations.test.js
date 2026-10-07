const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-operations-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { validateItem, checkTransition, overdueFollowups, buildOverview } = require('../operations');
const { workItems, payments, users } = require('../store');

const actorId = users.create('ops-owner', 'hash', 'totp-secret', 'owner');
const HOUR = 3600000;

function mockResponse() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('validates department, type, and applies priority SLA due dates', () => {
  const now = Date.parse('2026-09-28T08:00:00Z');
  const item = validateItem({ department: 'it', type: 'incident', title: 'VPN down', priority: 'urgent' }, now);
  assert.equal(item.dueAt, '2026-09-28T12:00:00.000Z');
  assert.throws(() => validateItem({ department: 'finance', type: 'x', title: 'x' }), /department must be one of/);
  assert.throws(() => validateItem({ department: 'hr', type: 'incident', title: 'x' }), /type for hr/);
  assert.throws(() => validateItem({ department: 'hr', type: 'hiring', title: '' }), /title is required/);
  assert.throws(() => validateItem({ department: 'hr', type: 'hiring', title: 'x', priority: 'asap' }), /priority/);
});

test('manufacturing work must pass quality check before done', () => {
  const order = { department: 'manufacturing', type: 'maintenance', status: 'in_progress' };
  assert.equal(checkTransition(order, 'done').ok, false);
  assert.equal(checkTransition(order, 'quality_check').ok, true);
  assert.equal(checkTransition({ ...order, status: 'quality_check' }, 'done').ok, true);
  assert.equal(checkTransition({ department: 'it', type: 'incident', status: 'in_progress' }, 'done').ok, true);
});

test('billable work cannot start until full payment is confirmed', () => {
  const item = workItems.create({ id: 'wo-1', ...validateItem({ department: 'manufacturing', type: 'work_order', title: '500 branded crates', customer: 'Acme' }) }, actorId);
  assert.equal(workItems.transition('wo-1', 'in_progress', actorId).reason, 'payment-required');

  payments.record({ provider: 'mpesa-c2b', transactionId: 'WO-PAY-SHORT', reference: 'WO-REF-SHORT', amount: 10, currency: 'KES', status: 'underpaid' });
  assert.equal(workItems.transition('wo-1', 'in_progress', actorId, { paymentReference: 'WO-REF-SHORT' }).reason, 'payment-required');

  payments.record({ provider: 'mpesa-c2b', transactionId: 'WO-PAY-1', reference: 'WO-REF-1', amount: 50000, currency: 'KES' });
  const started = workItems.transition('wo-1', 'in_progress', actorId, { paymentReference: 'WO-REF-1' });
  assert.equal(started.ok, true);
  assert.equal(started.item.paymentReference, 'WO-REF-1');
  assert.equal(item.status, 'open');
  assert.equal(workItems.listAudit('wo-1')[0].action, 'status-in_progress');
});

test('non-billable department work starts without payment', () => {
  workItems.create({ id: 'hr-1', ...validateItem({ department: 'hr', type: 'onboarding', title: 'Onboard new engineer' }) }, actorId);
  assert.equal(workItems.transition('hr-1', 'in_progress', actorId).ok, true);
  assert.equal(workItems.transition('hr-1', 'open', actorId).reason, 'invalid-transition');
});

test('flags overdue sales follow-ups by status SLA', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const leads = [
    { ref: 'a', followupStatus: 'new', createdAt: '2026-09-27 10:00:00' },
    { ref: 'b', followupStatus: 'new', createdAt: '2026-09-28 10:00:00' },
    { ref: 'c', followupStatus: 'contacted', createdAt: '2026-09-01 10:00:00', followupUpdatedAt: '2026-09-24 10:00:00' },
    { ref: 'd', followupStatus: 'won', createdAt: '2026-09-01 10:00:00' },
  ];
  assert.deepEqual(overdueFollowups(leads, now).map((l) => l.ref), ['a', 'c']);
});

test('overview counts open and overdue work per department', () => {
  const now = Date.now();
  const items = [
    { department: 'service', status: 'open', dueAt: new Date(now - HOUR).toISOString() },
    { department: 'service', status: 'done', dueAt: new Date(now - HOUR).toISOString() },
    { department: 'it', status: 'in_progress', dueAt: new Date(now + HOUR).toISOString() },
  ];
  const overview = buildOverview(items, [], now);
  assert.equal(overview.departments.service.open, 1);
  assert.equal(overview.departments.service.overdue, 1);
  assert.equal(overview.departments.it.overdue, 0);
  assert.equal(overview.overdueItems.length, 1);
  assert.equal(overview.departments.marketing_sales.overdueFollowups, 0);
});

test('operations API returns 402 when billable service work starts unpaid', () => {
  const app = require('../server');
  const handler = (routePath, method) => app._router.stack
    .find((layer) => layer.route?.path === routePath && layer.route.methods[method]).route.stack.at(-1).handle;

  const created = mockResponse();
  handler('/api/operations/items', 'post')({ body: { department: 'service', type: 'service_job', title: 'On-site repair' }, session: { userId: actorId } }, created);
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.billable, true);

  const blocked = mockResponse();
  handler('/api/operations/items/:id/status', 'patch')({ params: { id: created.body.id }, body: { status: 'in_progress' }, session: { userId: actorId } }, blocked);
  assert.equal(blocked.statusCode, 402);
  assert.equal(blocked.body.code, 'payment_required');

  const invalid = mockResponse();
  handler('/api/operations/items', 'post')({ body: { department: 'service', type: 'work_order', title: 'x' }, session: { userId: actorId } }, invalid);
  assert.equal(invalid.statusCode, 400);
});
