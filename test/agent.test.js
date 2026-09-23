const test = require('node:test');
const assert = require('node:assert/strict');

const { Agent } = require('../agent.js');

test('agent produces a valid execution plan for a repo task', () => {
  const agent = new Agent({ name: 'Dispatch Agent' });
  const result = agent.handleRequest('Audit the project for deployment risks');

  assert.equal(result.name, 'Dispatch Agent');
  assert.equal(result.status, 'ready');
  assert.ok(Array.isArray(result.steps));
  assert.ok(result.steps.length > 0);
  assert.match(result.summary, /deployment|risk|project/i);
});
