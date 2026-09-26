const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_BITCOIN_WALLET_ADDRESS,
  DEFAULT_ETHEREUM_WALLET_ADDRESS,
  resolveWallets,
  buildPaymentOptions,
  buildPublicConfig,
} = require('../payment-catalog');

const paymentsOptionsFn = require('../netlify/functions/payments-options');
const publicConfigFn = require('../netlify/functions/public-config');

const repoRoot = path.join(__dirname, '..');

test('wallet addresses fall back to documented defaults', () => {
  const wallets = resolveWallets({});

  assert.equal(wallets.bitcoin.address, DEFAULT_BITCOIN_WALLET_ADDRESS);
  assert.equal(wallets.ethereum.address, DEFAULT_ETHEREUM_WALLET_ADDRESS);
  assert.equal(wallets.bitcoin.enabled, true);
  assert.equal(wallets.ethereum.enabled, true);
});

test('wallet addresses come from the environment when provided', () => {
  const wallets = resolveWallets({
    BITCOIN_WALLET_ADDRESS: ' bc1qenvwallet ',
    ETHEREUM_WALLET_ADDRESS: '0xabc',
  });

  assert.equal(wallets.bitcoin.address, 'bc1qenvwallet');
  assert.equal(wallets.ethereum.address, '0xabc');
});

test('payment options always advertise BTC and ETH addresses', () => {
  const options = buildPaymentOptions({ env: {} });

  assert.equal(options.providers.bitcoin.enabled, true);
  assert.equal(options.providers.ethereum.enabled, true);
  assert.equal(options.providers.bitcoin.address, DEFAULT_BITCOIN_WALLET_ADDRESS);
  assert.equal(options.providers.ethereum.address, DEFAULT_ETHEREUM_WALLET_ADDRESS);
  assert.deepEqual(options.supportedCurrencies, ['USD', 'KES', 'BTC', 'ETH']);
});

test('public config exposes plan pricing and wallet availability', () => {
  const publicConfig = buildPublicConfig({ env: {} });

  assert.equal(publicConfig.payments.bitcoin, true);
  assert.equal(publicConfig.payments.ethereum, true);
  assert.equal(publicConfig.plans.starter.priceMonthly, '79.00');
  assert.equal(publicConfig.plans.growth.priceAnnual, '2490.00');
  assert.equal(publicConfig.paypalClientId, null);
});

test('netlify payments-options function returns the wallet payload', async () => {
  const response = await paymentsOptionsFn.handler({ httpMethod: 'GET' });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['Content-Type'], /application\/json/);
  assert.ok(body.providers.bitcoin.address);
  assert.ok(body.providers.ethereum.address);
});

test('netlify public-config function returns the public config payload', async () => {
  const response = await publicConfigFn.handler({ httpMethod: 'GET' });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.payments.bitcoin, true);
  assert.ok(body.plans.starter.priceMonthly);
});

test('netlify functions reject non-read methods', async () => {
  const response = await paymentsOptionsFn.handler({ httpMethod: 'POST' });

  assert.equal(response.statusCode, 405);
});

test('netlify.toml routes the stateless API to Netlify Functions', () => {
  const toml = fs.readFileSync(path.join(repoRoot, 'netlify.toml'), 'utf8');

  assert.match(toml, /functions = "netlify\/functions"/);
  assert.match(toml, /to = "\/\.netlify\/functions\/payments-options"/);
  assert.match(toml, /to = "\/\.netlify\/functions\/public-config"/);

  const optionsIndex = toml.indexOf('from = "/api/payments/options"');
  const catchAllIndex = toml.indexOf('from = "/api/*"');
  assert.ok(optionsIndex !== -1 && catchAllIndex !== -1);
  assert.ok(optionsIndex < catchAllIndex, 'function redirects must precede the /api/* proxy');
});

test('the billing pages resolve API URLs through the shared client', () => {
  const billing = fs.readFileSync(path.join(repoRoot, 'public', 'billing.html'), 'utf8');
  const staticBilling = fs.readFileSync(path.join(repoRoot, 'netlify-static', 'billing.html'), 'utf8');

  assert.match(billing, /src="\/api-base\.js"/);
  assert.match(billing, /DispatchAPI\.fetchWithRetry\('\/api\/payments\/options'/);
  assert.match(staticBilling, /src="api-base\.js"/);
  assert.match(staticBilling, /DispatchAPI\.fetchWithRetry\('\/api\/payments\/options'/);
  assert.ok(!staticBilling.includes('API_BASE_URL'), 'static billing page must not hardcode an API origin');
  assert.match(billing, /liveQuotes\?\.\[plan\]\?\.\[method\]\?\.amount/);
  assert.match(billing, /Using live fallback quote/);
  assert.match(staticBilling, /liveQuotes\?\.\[selectedPlan\]\?\.\[method\]\?\.amount/);
  assert.match(staticBilling, /pendingOffline/);
});
