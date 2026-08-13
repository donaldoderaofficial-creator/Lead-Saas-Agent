/**
 * M-Pesa Daraja client (STK Push / Lipa Na M-Pesa Online).
 * Credentials come from environment variables only.
 *
 * Get sandbox credentials from https://developer.safaricom.co.ke
 * (create an app -> Lipa Na M-Pesa Sandbox -> Consumer Key/Secret + test shortcode/passkey)
 *
 * .env additions:
 *   MPESA_CONSUMER_KEY=your-consumer-key
 *   MPESA_CONSUMER_SECRET=your-consumer-secret
 *   MPESA_SHORTCODE=174379          # sandbox default paybill, or your own
 *   MPESA_PASSKEY=your-passkey
 *   MPESA_ENV=sandbox               # or 'production'
 *   MPESA_CALLBACK_URL=https://your-public-url/payments/mpesa/callback
 */

require('dotenv').config();

const BASE_URL = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing ${name}. Set it in your .env file.`);
  return val;
}

function baseUrl() {
  return BASE_URL[process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox'];
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function getAccessToken() {
  const key = requireEnv('MPESA_CONSUMER_KEY');
  const secret = requireEnv('MPESA_CONSUMER_SECRET');
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');

  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) throw new Error(`M-Pesa auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/**
 * Trigger an STK Push prompt on the payer's phone.
 * @param {{ phone: string, amount: number, accountReference: string, description: string }} params
 *   phone must be in 2547XXXXXXXX format (no '+', no leading 0).
 */
async function initiateSTKPush({ phone, amount, accountReference, description }) {
  const shortcode = requireEnv('MPESA_SHORTCODE');
  const passkey = requireEnv('MPESA_PASSKEY');
  const callbackUrl = requireEnv('MPESA_CALLBACK_URL');
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64');
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: description,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`STK push failed: ${JSON.stringify(data)}`);
  return data; // includes CheckoutRequestID
}

module.exports = { initiateSTKPush };
