const assert = require('node:assert/strict');
const signature = require('cookie-signature');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dbPath = path.join(os.tmpdir(), `lead-agent-website-${process.pid}.db`);
const sessionDbPath = path.join(os.tmpdir(), `lead-agent-website-sessions-${process.pid}.sqlite`);
for (const filePath of [dbPath, sessionDbPath]) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(filePath + suffix); } catch (_) {}
  }
}

process.env.PORT = process.env.PORT || '3211';
process.env.DB_PATH = dbPath;
process.env.SESSION_DB_PATH = sessionDbPath;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';
process.env.BITCOIN_WALLET_ADDRESS = process.env.BITCOIN_WALLET_ADDRESS || 'bc1qwalletbitcoinaddress';
process.env.ETHEREUM_WALLET_ADDRESS = process.env.ETHEREUM_WALLET_ADDRESS || '0x1234567890abcdef1234567890abcdef12345678';

const app = require('../server');

function buildSessionCookie(sid = 'website-speed-test') {
  const value = `s:${signature.sign(sid, process.env.SESSION_SECRET)}`;
  return `connect.sid=${encodeURIComponent(value)}`;
}

test('public pages and config endpoints send browser cache headers', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const [home, asset, config] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/`),
      fetch(`http://127.0.0.1:${port}/api-base.js`),
      fetch(`http://127.0.0.1:${port}/api/config`),
    ]);

    assert.equal(home.status, 200);
    assert.equal(home.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=86400');
    assert.equal(config.status, 200);
    assert.equal(config.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=900');
  } finally {
    server.close();
  }
});

test('public website routes bypass session store lookups', async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const originalGet = app.sessionStore.get.bind(app.sessionStore);
  const observedSids = [];

  app.sessionStore.get = (sid, callback) => {
    observedSids.push(sid);
    return originalGet(sid, callback);
  };

  try {
    const headers = { Cookie: buildSessionCookie() };
    const publicResponse = await fetch(`http://127.0.0.1:${port}/api/config`, { headers });

    assert.equal(publicResponse.status, 200);
    assert.equal(observedSids.length, 0, 'public config should not touch the session store');

    const sessionResponse = await fetch(`http://127.0.0.1:${port}/health`, { headers });

    assert.equal(sessionResponse.status, 200);
    assert.equal(observedSids.length, 1, 'session-backed routes should still resolve the supplied session');
  } finally {
    app.sessionStore.get = originalGet;
    server.close();
  }
});
