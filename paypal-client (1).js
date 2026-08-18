/**
 * PayPal client setup. Credentials come from environment variables only —
 * never hardcode a Client ID / Secret in source. Get sandbox credentials
 * from https://developer.paypal.com/dashboard/applications/sandbox
 *
 * .env (not committed to git):
 *   PAYPAL_CLIENT_ID=your-sandbox-client-id
 *   PAYPAL_CLIENT_SECRET=your-sandbox-secret
 *   PAYPAL_ENV=sandbox
 *   PAYPAL_WEBHOOK_ID=your-webhook-id   # from the webhook you register in the dashboard
 */

require('dotenv').config();
const checkoutNodeJssdk = require('@paypal/checkout-server-sdk');

function credentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET. Set them in a .env file.'
    );
  }
  return { clientId, clientSecret };
}

function isLive() {
  return process.env.PAYPAL_ENV === 'live';
}

function environment() {
  const { clientId, clientSecret } = credentials();
  return isLive()
    ? new checkoutNodeJssdk.core.LiveEnvironment(clientId, clientSecret)
    : new checkoutNodeJssdk.core.SandboxEnvironment(clientId, clientSecret);
}

function client() {
  return new checkoutNodeJssdk.core.PayPalHttpClient(environment());
}

function apiBase() {
  return isLive() ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken() {
  const { clientId, clientSecret } = credentials();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/**
 * Verify a webhook event actually came from PayPal, using the transmission
 * headers PayPal sends with every webhook POST. Returns true/false — never
 * trust a webhook event without this passing.
 */
async function verifyWebhookSignature(headers, body) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('Missing PAYPAL_WEBHOOK_ID. Set it in your .env file.');

  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: body,
    }),
  });

  if (!res.ok) throw new Error(`Webhook verification request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

/**
 * Create a Catalog product — a one-time setup step, run once via
 * deploy/setup-paypal-subscriptions.js, not on every server boot.
 */
async function createProduct({ name, description }) {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `product-${Date.now()}`,
    },
    body: JSON.stringify({ name, description, type: 'SERVICE', category: 'SOFTWARE' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create product failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/**
 * Create a monthly billing plan tied to a product — also one-time setup.
 */
async function createMonthlyPlan({ productId, name, description, priceUsd }) {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({
      product_id: productId,
      name,
      description,
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // 0 = runs indefinitely until cancelled
          pricing_scheme: { fixed_price: { value: priceUsd, currency_code: 'USD' } },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create plan failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/**
 * Look up a subscription's current status/next billing date directly from
 * PayPal — used as a fallback if a webhook event is ever missed.
 */
async function getSubscriptionDetails(subscriptionId) {
  const token = await getAccessToken();
  const res = await fetch(`${apiBase()}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Get subscription failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

module.exports = {
  client,
  checkoutNodeJssdk,
  verifyWebhookSignature,
  createProduct,
  createMonthlyPlan,
  getSubscriptionDetails,
};
