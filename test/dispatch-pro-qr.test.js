const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const target = 'https://lead-saas-agent.netlify.app';
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('QR image is a valid PNG in each static publishing root', () => {
  for (const directory of ['public', 'netlify-static']) {
    const imagePath = path.join(root, directory, 'dispatch-pro-qr.png');
    const signature = fs.readFileSync(imagePath).subarray(0, pngSignature.length);
    assert.deepEqual(signature, pngSignature, `${directory} QR asset should be a PNG`);
  }
});

test('landing pages expose an accessible QR linking to the live Dispatch Pro app', () => {
  for (const directory of ['public', 'netlify-static']) {
    const html = fs.readFileSync(path.join(root, directory, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`<img[^>]+src=["']/?dispatch-pro-qr\\.png["']`), `${directory} page should load its QR image`);
    assert.match(html, /alt=["'][^"']*QR code[^"']*["']/i, `${directory} QR image should have descriptive alt text`);
    assert.match(html, new RegExp(`href=["']${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`), `${directory} page should link to the live app`);
    const platform = html.match(/<section\b[^>]*id=["']platform["'][^>]*>[\s\S]*?<\/section>/i);
    assert.ok(platform, `${directory} page should have a platform features section`);
    assert.match(platform[0], /class=["']feature-qr["']/, `${directory} QR should appear below the feature cards`);
    assert.match(platform[0], /Scan this QR code to access Dispatch Pro via phone\./, `${directory} section should show the requested prompt`);
    assert.match(platform[0], /alt=["']QR code to access Dispatch Pro via phone["']/, `${directory} QR should have descriptive alt text`);
  }
});
