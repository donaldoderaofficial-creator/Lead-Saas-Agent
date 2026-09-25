#!/usr/bin/env node

const DEFAULT_FRONTEND_URL = 'https://lead-saas-agent.netlify.app';
const DEFAULT_HEALTHCHECK_URL = `${DEFAULT_FRONTEND_URL}/health`;

const REQUEST_TIMEOUT_MS = Number(process.env.UPTIME_TIMEOUT_MS || 15000);
const RETRIES = Number(process.env.UPTIME_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.UPTIME_RETRY_DELAY_MS || 20000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(value) {
  return value && value.trim() ? value.trim() : null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': 'lead-agent-uptime-monitor/1.0',
      accept: 'application/json, text/html;q=0.9, */*;q=0.8',
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const contentType = response.headers.get('content-type') || '';
  let body = null;
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  return { response, body };
}

async function verifyCheck(check) {
  const { response, body } = await fetchJson(check.url);

  if (!response.ok) {
    throw new Error(`returned ${response.status}`);
  }

  if (check.expectStatus && (!body || typeof body !== 'object' || body.status !== check.expectStatus)) {
    throw new Error(`returned unexpected status payload: ${JSON.stringify(body)}`);
  }
}

async function runCheck(check) {
  let lastError = null;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      await verifyCheck(check);
      console.log(`✓ ${check.name} ok (${check.url})`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`✗ ${check.name} failed on attempt ${attempt}/${RETRIES}: ${error.message}`);
      if (attempt < RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(`${check.name} check failed after ${RETRIES} attempts: ${lastError.message}`);
}

async function triggerHook(name, url) {
  if (!normalizeUrl(url)) {
    return false;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'user-agent': 'lead-agent-uptime-monitor/1.0',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      source: 'github-actions',
      reason: 'production uptime checks failed',
      triggeredAt: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${name} hook returned ${response.status}`);
  }

  console.log(`↻ Triggered ${name} recovery hook`);
  return true;
}

async function main() {
  const frontendUrl = normalizeUrl(process.env.FRONTEND_URL) || DEFAULT_FRONTEND_URL;
  const healthcheckUrl = normalizeUrl(process.env.HEALTHCHECK_URL) || DEFAULT_HEALTHCHECK_URL;
  const readycheckUrl = normalizeUrl(process.env.READYCHECK_URL);
  const healthcheckExpectedStatus = normalizeUrl(process.env.HEALTHCHECK_EXPECTED_STATUS) || 'ok';
  const readycheckExpectedStatus = normalizeUrl(process.env.READYCHECK_EXPECTED_STATUS) || 'ready';

  const checks = [
    { name: 'frontend', url: frontendUrl },
    { name: 'health', url: healthcheckUrl, expectStatus: healthcheckExpectedStatus },
  ];

  if (readycheckUrl) {
    checks.push({ name: 'ready', url: readycheckUrl, expectStatus: readycheckExpectedStatus });
  }

  const failures = [];
  for (const check of checks) {
    try {
      await runCheck(check);
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (!failures.length) {
    console.log('All production uptime checks passed.');
    return;
  }

  console.error('Production uptime checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }

  let recoveryTriggered = false;
  const recoveryFailures = [];
  for (const [name, url] of [
    ['Netlify', process.env.NETLIFY_BUILD_HOOK_URL],
    ['Render', process.env.RENDER_DEPLOY_HOOK_URL],
  ]) {
    if (!normalizeUrl(url)) {
      continue;
    }

    recoveryTriggered = true;
    try {
      await triggerHook(name, url);
    } catch (error) {
      recoveryFailures.push(`${name}: ${error.message}`);
      console.error(`Recovery hook failed for ${name}: ${error.message}`);
    }
  }

  if (recoveryFailures.length) {
    throw new Error(`Uptime failures: ${failures.join('; ')}. Recovery hook failures: ${recoveryFailures.join('; ')}`);
  }

  if (recoveryTriggered) {
    throw new Error(`Uptime failures: ${failures.join('; ')}. Triggered configured recovery hook(s).`);
  }

  throw new Error(`Uptime failures: ${failures.join('; ')}. No recovery hooks configured. Add NETLIFY_BUILD_HOOK_URL and/or RENDER_DEPLOY_HOOK_URL secrets.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
