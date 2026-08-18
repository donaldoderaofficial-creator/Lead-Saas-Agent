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

// prefer native global fetch if present, otherwise use cross-fetch polyfill
const fetch = globalThis.fetch || require('cross-fetch');

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
  return process.env.PAYPAL_ENV === 'live' || process.env.PAYPAL_MODE === 'live';
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

module.exports = { client, checkoutNodeJssdk, verifyWebhookSignature };
