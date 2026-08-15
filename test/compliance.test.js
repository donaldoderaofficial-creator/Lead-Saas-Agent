const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-compliance-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;

const { assess } = require('../compliance');
const { compliance } = require('../store');

test('allows an ordinary lead request', () => {
  const result = assess({
    email: 'safe@example.com',
    campaign: 'Reach operations managers at local manufacturers.',
  });
  assert.equal(result.allowed, true);
});

test('suspends a client after repeat policy violations', () => {
  const payload = {
    email: 'repeat@example.com',
    instructions: 'Run a phishing campaign for stolen credentials.',
  };
  const first = assess(payload);
  const second = assess(payload);

  assert.equal(first.allowed, false);
  assert.equal(first.violationCount, 1);
  assert.equal(second.allowed, false);
  assert.equal(second.violationCount, 2);
  assert.equal(compliance.getClient('repeat@example.com').status, 'suspended');
});

test('requires verified payment before reinstatement and records an audit event', () => {
  const clientKey = 'repeat@example.com';
  assert.deepEqual(compliance.reinstate(clientKey), { ok: false, reason: 'payment-not-verified' });

  compliance.recordVerifiedPayment(clientKey, 'MPESA-TEST-REFERENCE', 1);
  assert.deepEqual(compliance.reinstate(clientKey), { ok: true });

  const events = compliance.listAudit().map((event) => event.event_type);
  assert.ok(events.includes('payment-verified'));
});
