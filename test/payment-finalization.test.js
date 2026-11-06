const assert = require('node:assert/strict');
const test = require('node:test');

const { createSingleFlight } = require('../services/payment-finalization');

test('shares concurrent work for one payment reference', async () => {
  const runOnce = createSingleFlight();
  let release;
  let calls = 0;
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = runOnce('payment-1', operation);
  const duplicate = runOnce('payment-1', operation);

  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);
  release('completed');
  assert.equal(await first, 'completed');
});

test('allows different payment references to process independently', async () => {
  const runOnce = createSingleFlight();
  const results = await Promise.all([
    runOnce('payment-1', async () => 'first'),
    runOnce('payment-2', async () => 'second'),
  ]);

  assert.deepEqual(results, ['first', 'second']);
});

test('allows a retry after finalization fails', async () => {
  const runOnce = createSingleFlight();
  let calls = 0;
  await assert.rejects(runOnce('payment-1', async () => {
    calls += 1;
    throw new Error('temporary processing failure');
  }), /temporary processing failure/);

  assert.equal(await runOnce('payment-1', async () => {
    calls += 1;
    return 'retried';
  }), 'retried');
  assert.equal(calls, 2);
});
