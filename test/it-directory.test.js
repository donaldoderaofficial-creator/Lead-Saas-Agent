const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

process.env.DB_PATH = path.join(os.tmpdir(), `lead-agent-it-directory-${process.pid}.db`);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { directory } = require('../store');
const { users } = require('../store');
const { createItDirectoryService, DirectoryValidationError } = require('../services/it-directory-service');
const { createItDirectoryRouter } = require('../routes/it-directory');

const actorId = users.create(`it-admin-${process.pid}`, 'test-hash', 'test-totp', 'admin');
const service = createItDirectoryService({ directory });

function directoryObject(values = {}) {
  return {
    objectClass: 'user',
    name: `Directory User ${crypto.randomUUID()}`,
    department: 'Sales',
    ouDn: 'OU=Sales,DC=acme,DC=com',
    username: 'sales.user',
    email: 'sales.user@example.test',
    ...values,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    if (req.get('authorization') !== 'Bearer test-token') {
      return res.status(401).json({ error: 'Not logged in' });
    }
    req.session = { userId: actorId };
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (req.get('x-role') !== 'admin') {
      return res.status(403).json({ error: 'Administrator access required' });
    }
    next();
  };
  app.use('/api/it', createItDirectoryRouter({ service, requireAuth, requireAdmin }));
  return app;
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('creates and searches objects within an OU subtree using LDAP-style filters', () => {
  const salesUser = service.createObject(directoryObject(), actorId);
  const nestedComputer = service.createObject(directoryObject({
    objectClass: 'computer',
    name: `Sales Workstation ${crypto.randomUUID()}`,
    username: null,
    email: null,
    hostname: 'sales-ws-01',
    ouDn: 'OU=Workstations,OU=Sales,DC=acme,DC=com',
  }), actorId);
  service.createObject(directoryObject({
    objectClass: 'user',
    department: 'Finance',
    ouDn: 'OU=Finance,DC=acme,DC=com',
  }), actorId);

  const result = service.search({
    base: 'OU=Sales,DC=acme,DC=com',
    filter: '(&(objectClass=user)(department=Sales))',
  });
  assert.deepEqual(result.results.map((entry) => entry.id), [salesUser.id]);
  assert.equal(result.results[0].username, 'sales.user');

  const nested = service.search({
    base: 'OU=Sales,DC=acme,DC=com',
    filter: '(objectClass=computer)',
  });
  assert.deepEqual(nested.results.map((entry) => entry.id), [nestedComputer.id]);
});

test('supports group filters, presence filters, pagination bounds, and directory updates', () => {
  const specialName = service.createObject(directoryObject({
    name: `Star*Record ${crypto.randomUUID()}`,
  }), actorId);
  const group = service.createObject(directoryObject({
    objectClass: 'group',
    name: `Sales Group ${crypto.randomUUID()}`,
    username: null,
    email: null,
    members: ['sales.user', 'sales.manager'],
  }), actorId);

  const result = service.search({
    base: 'DC=acme,DC=com',
    filter: '(|(&(objectClass=group)(department=Sales))(objectClass=computer))',
    limit: 1,
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.limit, 1);

  const presence = service.search({
    filter: '(&(objectClass=group)(members=*))',
  });
  assert.ok(presence.results.some((entry) => entry.id === group.id));

  const escaped = service.search({ filter: `(name=${specialName.name.replace('*', '\\2a')})` });
  assert.deepEqual(escaped.results.map((entry) => entry.id), [specialName.id]);

  const updated = service.updateObject(group.id, { location: 'Head office' }, actorId);
  assert.equal(updated.location, 'Head office');
  assert.deepEqual(directory.listAudit(group.id).map((entry) => entry.action), ['updated', 'created']);
});

test('rejects unsafe LDAP filters, invalid DNs, and credential-like attributes', () => {
  assert.throws(() => service.search({ filter: '(objectClass=user); DROP TABLE users' }), DirectoryValidationError);
  assert.throws(() => service.search({ filter: '(passwordHash=*)' }), DirectoryValidationError);
  assert.throws(() => service.search({ base: 'OU=Sales,DC=acme;DROP TABLE users' }), DirectoryValidationError);
  assert.throws(() => service.search({ limit: 1000 }), DirectoryValidationError);
  assert.throws(() => service.createObject({ ...directoryObject(), passwordHash: 'secret' }, actorId), DirectoryValidationError);
});

test('OU subtree lookup is backed by the indexed reversed-DN key', () => {
  const db = new DatabaseSync(process.env.DB_PATH);
  try {
    const plan = db.prepare(`EXPLAIN QUERY PLAN
      SELECT id FROM it_directory_objects
      WHERE ou_dn_key >= ? COLLATE NOCASE AND ou_dn_key < ? COLLATE NOCASE`)
      .all('moc.cd,emca,selas=uo', 'moc.cd,emca,selas=uo,\uffff');
    assert.match(plan.map((entry) => entry.detail).join(' '), /idx_it_directory_ou/);
  } finally {
    db.close();
  }
});

test('security guide documents OSI controls and safe policy-versus-Kerberos lockout triage', () => {
  const guide = service.getSecurityGuide();
  assert.equal(guide.osiLayers.length, 7);
  assert.ok(guide.policies.some((policy) => /Machine inactivity limit/.test(policy.setting)));
  assert.ok(guide.policies.some((policy) => /Removable Storage/.test(policy.setting)));
  assert.match(guide.lockoutTriage.policyAction, /Do not bypass/);
  assert.match(guide.lockoutTriage.kerberosAction, /time|DNS|replication/i);
});

test('IT directory endpoints require authentication and administrator authorization', async () => {
  await withServer(createApp(), async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/it/directory`);
    assert.equal(unauthenticated.status, 401);

    const forbidden = await fetch(`${baseUrl}/api/it/security-guide`, {
      headers: { authorization: 'Bearer test-token', 'x-role': 'user' },
    });
    assert.equal(forbidden.status, 403);

    const created = await fetch(`${baseUrl}/api/it/directory`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'x-role': 'admin',
        'content-type': 'application/json',
      },
      body: JSON.stringify(directoryObject({ objectClass: 'printer', name: `Printer ${crypto.randomUUID()}`, username: null, email: null, hostname: 'sales-printer-01' })),
    });
    assert.equal(created.status, 201);
    const object = await created.json();
    assert.equal(object.objectClass, 'printer');
    assert.equal(Object.prototype.hasOwnProperty.call(object, 'passwordHash'), false);

    const updated = await fetch(`${baseUrl}/api/it/directory/${encodeURIComponent(object.id)}`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer test-token',
        'x-role': 'admin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ location: 'Head office' }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).location, 'Head office');

    const audit = await fetch(`${baseUrl}/api/it/directory/${encodeURIComponent(object.id)}/audit`, {
      headers: { authorization: 'Bearer test-token', 'x-role': 'admin' },
    });
    assert.equal(audit.status, 200);
    assert.deepEqual((await audit.json()).audit.map((entry) => entry.action), ['updated', 'created']);

    const guide = await fetch(`${baseUrl}/api/it/security-guide`, {
      headers: { authorization: 'Bearer test-token', 'x-role': 'admin' },
    });
    assert.equal(guide.status, 200);
    assert.equal((await guide.json()).osiLayers.length, 7);
  });
});
