const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-payments-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;

const { payments } = require('../store');

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