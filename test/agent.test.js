const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { Agent } = require('../agent.js');
const { processLead } = require('../lead-pipeline');

test('agent produces a valid execution plan for a repo task', () => {
  const agent = new Agent({ name: 'Dispatch Agent' });
  const result = agent.handleRequest('Audit the project for deployment risks');

  assert.equal(result.name, 'Dispatch Agent');
  assert.equal(result.status, 'ready');
  assert.ok(Array.isArray(result.steps));
  assert.ok(result.steps.length > 0);
  assert.match(result.summary, /deployment|risk|project/i);
  assert.ok(result.steps.every((step) => !/exciting|happy to help|in order to/i.test(step.description)));
});

test('lead pipeline logs concise processing signals without echoing personal data', async () => {
  const outcome = await processLead({
    name: 'Private Person',
    email: 'private.person@example.test',
    companySize: 'small',
    urgency: 'high',
  });
  assert.ok(outcome.log.some((entry) => /^Score: \d+\/100$/.test(entry)));
  assert.ok(outcome.log.some((entry) => /^Route: /.test(entry)));
  assert.doesNotMatch(outcome.log.join(' '), /Private Person|private\.person@example\.test/);
});
