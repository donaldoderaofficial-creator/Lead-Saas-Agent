const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');

test('exposes a top-level deploy script for the existing Netlify deployment flow', () => {
  assert.equal(packageJson.scripts.deploy, 'npm run deploy:netlify');
  assert.equal(packageJson.scripts['deploy:netlify'], 'bash scripts/deploy-netlify.sh public');
});
