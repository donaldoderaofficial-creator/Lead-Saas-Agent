const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-safety-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
}
process.env.DB_PATH = dbPath;

const { parseDataset, validateObservation } = require('../geospatial-safety');
const { safetyIncidents } = require('../store');

test('records mapped injury observations from both business environments', () => {
  const observations = parseDataset(JSON.stringify([
    {
      businessId: 'business-1',
      environment: 'micro',
      latitude: -1.2864,
      longitude: 36.8172,
      injuryType: 'fall',
      severity: 'high',
      description: 'Observed injury beside the loading bay',
      observedAt: '2026-09-05T08:30:00Z',
    },
    {
      businessId: 'business-1',
      environment: 'macro',
      latitude: -1.2921,
      longitude: 36.8219,
      injuryType: 'traffic collision',
      severity: 'moderate',
      description: 'Observed injury on the adjacent public road',
      observedAt: '2026-09-05T09:00:00Z',
    },
  ]));

  observations.forEach((raw, index) => {
    const observation = validateObservation(raw);
    safetyIncidents.create({ id: `safety-${index}`, ...observation, createdBy: 0 });
  });

  assert.deepEqual(safetyIncidents.list().map((incident) => incident.environment).sort(), ['macro', 'micro']);
  assert.equal(safetyIncidents.get('safety-0').latitude, -1.2864);
  assert.equal(safetyIncidents.listAudit('safety-0')[0].action, 'recorded');
});

test('rejects observations without valid mapped coordinates', () => {
  assert.throws(() => validateObservation({
    businessId: 'business-1',
    environment: 'micro',
    latitude: 95,
    longitude: 36.8172,
    injuryType: 'fall',
    severity: 'high',
    description: 'Invalid location',
  }), /latitude/);
});