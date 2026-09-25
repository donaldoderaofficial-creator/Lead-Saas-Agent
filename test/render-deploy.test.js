const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');

test('render deployment workflow triggers a cloud deploy hook', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'render.yml'), 'utf8');

  assert.match(workflow, /name:\s*Render deploy/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /RENDER_DEPLOY_HOOK_URL/);
  assert.match(workflow, /RENDER_DEPLOY_HOOK_URL must start with https:\/\//);
  assert.match(workflow, /curl /);
  assert.match(workflow, /--fail/);
  assert.match(workflow, /--show-error/);
  assert.match(workflow, /--silent/);
  assert.match(workflow, /--max-redirs 0/);
  assert.match(workflow, /--retry 3/);
  assert.match(workflow, /--retry-all-errors/);
  assert.match(workflow, /-X POST "\$RENDER_DEPLOY_HOOK_URL"/);
});
