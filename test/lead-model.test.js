const assert = require('node:assert/strict');
const test = require('node:test');
const { LeadModel, scoreLead } = require('../lead-model');

test('scores leads deterministically from explicit features', () => {
  const first = scoreLead({ companySizeGuess: 'enterprise', intent: 'high' });
  const second = scoreLead({ companySizeGuess: 'enterprise', intent: 'high' });
  assert.deepEqual(first, second);
  assert.ok(first.score >= 0 && first.score <= 100);
});

test('backpropagation improves a labeled positive outcome', () => {
  const model = new LeadModel();
  const before = model.predict([0, 1]).probability;
  const result = model.train([{ features: [0, 1], label: 1 }], { epochs: 20 });
  assert.equal(result.trained, true);
  assert.ok(model.predict([0, 1]).probability > before);
});

test('training is bounded and ignores malformed labels', () => {
  const model = new LeadModel();
  const result = model.train([
    { features: [1, 0], label: 0 },
    { features: [1], label: 1 },
    { features: [0, 1], label: 2 },
  ], { epochs: 1000, learningRate: 10 });
  assert.equal(result.epochs, 100);
  assert.equal(result.samples, 3);
  assert.ok(Number.isFinite(model.predict([1, 0]).score));
});
