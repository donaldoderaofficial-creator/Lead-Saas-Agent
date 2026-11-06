const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const { createObservabilityRouter } = require('../routes/observability');
const { createObservabilityService } = require('../services/observability-service');

function createService(overrides = {}) {
  const calls = { smokeCheck: 0 };
  const deploymentStatus = {
    status: 'ready',
    missing: [],
    checks: { database: 'ok' },
  };
  const service = createObservabilityService({
    config: {
      env: 'test',
      sessionSecret: 'test-secret',
      publicAppUrl: 'https://app.example.test',
      security: { corsOrigins: ['https://app.example.test'] },
      payment: {
        paypal: { configured: false },
        mpesa: { configured: false },
      },
      wallets: {},
    },
    releaseAttribution: 'Dispatch Pro',
    checkDatabase: () => ({ status: 'ok' }),
    buildProductionSmokeCheckStatus: (input) => {
      calls.smokeCheck += 1;
      calls.input = input;
      return deploymentStatus;
    },
    logger: { getMetrics: () => ({ requests: 3 }) },
    cache: { stats: () => ({ hits: 2 }) },
    rateLimiter: { userLimits: new Map([['user-1', []]]) },
    businessMetrics: () => ({ leads: 4 }),
    env: { BUILD_SHA: 'build-123', EXPLORIUM_API_KEY: 'configured' },
    packageVersion: '1.2.3',
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    uptime: () => 42,
    ...overrides,
  });

  return { service, calls, deploymentStatus };
}

function createApp(service) {
  const app = express();
  const requireAuth = (req, res, next) => {
    if (req.get('authorization') !== 'Bearer test-token') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };
  app.use(createObservabilityRouter({ service, requireAuth }));
  return app;
}

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('health endpoint preserves release, timestamp, uptime, and prospecting fields', async () => {
  const { service } = createService();
  await withServer(createApp(service), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      release: { version: '1.2.3', build: 'build-123', attribution: 'Dispatch Pro' },
      timestamp: '2026-01-02T03:04:05.000Z',
      uptime: 42,
      prospecting: true,
    });
  });
});

test('readiness reports unavailable when database or deployment checks fail', async () => {
  const { service, deploymentStatus, calls } = createService({
    checkDatabase: () => ({ status: 'error', message: 'unavailable' }),
  });
  deploymentStatus.status = 'not_ready';

  await withServer(createApp(service), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ready`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, 'not_ready');
    assert.deepEqual(body.database, { status: 'error', message: 'unavailable' });
    assert.equal(body.deployment.status, 'not_ready');
  });
  assert.equal(calls.smokeCheck, 1);
});

test('deployment smoke endpoint returns the deployment check contract', async () => {
  const { service, calls } = createService({
    env: { MPESA_CALLBACK_URL: 'https://app.example.test/callback' },
  });
  await withServer(createApp(service), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/deploy/smoke`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ready',
      timestamp: '2026-01-02T03:04:05.000Z',
      missing: [],
      checks: { database: 'ok' },
    });
  });
  assert.equal(calls.input.mpesa.callbackUrl, 'https://app.example.test/callback');
  assert.equal(calls.input.paypal.enabled, false);
  assert.equal(calls.input.mpesa.enabled, false);
});

test('metrics remains protected by the existing authentication boundary', async () => {
  const { service } = createService();
  await withServer(createApp(service), async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/metrics`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: 'Bearer test-token' },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), {
      logger: { requests: 3 },
      cache: { hits: 2 },
      rateLimiter: 1,
      business: { leads: 4 },
    });
  });
});
