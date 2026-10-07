const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = (name) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8');

for (const name of ['netlify.yml', 'render.yml']) {
  test(`${name} deploys main only after CI passes`, () => {
    const text = workflow(name);
    assert.match(text, /workflow_run:\s*\n\s*workflows: \[CI\]/);
    assert.match(text, /github\.event\.workflow_run\.conclusion == 'success'/);
    assert.doesNotMatch(text, /^\s*push:/m);
  });
}

test('render deploy verifies the live backend serves the new commit', () => {
  const text = workflow('render.yml');
  assert.match(text, /RENDER_DEPLOY_HOOK_URL/);
  assert.match(text, /-X POST "\$RENDER_DEPLOY_HOOK_URL"/);
  assert.match(text, /"\$build" = "\$EXPECTED_SHA"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /process\.env\.RENDER_GIT_COMMIT/);
});
