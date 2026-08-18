const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { parseCorsOrigins, parsePort } = require('../config');

test('parses and trims configured CORS origins', () => {
  assert.deepEqual(
    parseCorsOrigins(' https://app.example.com, http://localhost:3000 '),
    ['https://app.example.com', 'http://localhost:3000']
  );
});

test('rejects invalid ports', () => {
  assert.throws(() => parsePort('70000'), /PORT must be an integer/);
  assert.throws(() => parsePort('not-a-port'), /PORT must be an integer/);
});

test('accepts valid ports', () => {
  assert.equal(parsePort('3000'), 3000);
});
