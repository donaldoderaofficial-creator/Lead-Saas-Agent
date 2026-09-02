const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-edrms-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;

const { records, users } = require('../store');

const actorId = users.create('edrms-owner', 'hash', 'totp-secret', 'owner');

test('creates and lists a draft record with retention metadata', () => {
  const record = records.create({
    id: 'record-1',
    title: 'Supplier agreement',
    recordType: 'contract',
    classification: 'confidential',
    owner: 'Operations',
    retentionUntil: '2030-12-31',
    storageUri: 's3://records/supplier-agreement.pdf',
    checksum: 'a'.repeat(64),
    metadata: { supplier: 'Example Ltd' },
    createdBy: actorId,
  });

  assert.equal(record.status, 'draft');
  assert.equal(record.retentionUntil, '2030-12-31');
  assert.deepEqual(record.metadata, { supplier: 'Example Ltd' });
  assert.equal(records.list({ recordType: 'contract' }).length, 1);
  assert.equal(records.listAudit('record-1')[0].action, 'created');
});

test('enforces controlled record lifecycle transitions', () => {
  assert.equal(records.transition('record-1', 'active', actorId).ok, true);
  assert.equal(records.transition('record-1', 'disposed', actorId).ok, false);
  assert.equal(records.transition('record-1', 'archived', actorId).ok, true);
  assert.equal(records.transition('record-1', 'disposed', actorId).ok, true);
  assert.equal(records.transition('record-1', 'active', actorId).reason, 'invalid-transition');
  assert.equal(records.listAudit('record-1').length, 4);
});
