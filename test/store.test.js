const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-store-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;

const { completedReports, leads } = require('../store');

test('lists leads with follow-up details in one result set', () => {
  const createdAt = new Date().toISOString();
  completedReports.set('lead-followup-test', {
    result: {
      name: 'Buyer',
      email: 'buyer@example.com',
      company: 'example.com',
      score: 92,
      companySizeGuess: 'small',
      intent: 'high',
      urgency: 'now',
      path: 'priority-outreach',
    },
    premium: {
      recommendedNextStep: 'Call immediately',
    },
    createdAt,
  });

  leads.setFollowup('lead-followup-test', 'contacted', 'Scheduled demo');

  const row = leads.listAll().find((lead) => lead.ref === 'lead-followup-test');

  assert.equal(row.name, 'Buyer');
  assert.equal(row.followupStatus, 'contacted');
  assert.equal(row.followupNotes, 'Scheduled demo');
  assert.match(row.followupUpdatedAt, /\d{4}-\d{2}-\d{2}/);
});
