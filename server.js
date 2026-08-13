/**
 * Lead-qualification agent, exposed as a small SaaS-style HTTP API.
 *
 * Flow for both payment methods:
 *   1. POST /api/lead stores the submitted lead against a payment reference
 *      (PayPal orderId, or an M-Pesa checkoutRequestId).
 *   2. When payment is confirmed — PayPal capture/webhook, or the M-Pesa
 *      callback — the server looks up that same lead and runs the pipeline.
 *   3. GET /leads/report/:ref returns the finished report once it's ready.
 * The client never has to resend name/email at report time.
 *
 * Run:   node server.js
 */

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { client, checkoutNodeJssdk, verifyWebhookSignature } = require('./paypal-client');
const { initiateSTKPush } = require('./mpesa-client');
const { processLead } = require('./lead-pipeline');
const { pendingLeads, completedReports, leads, users } = require('./store');
const { hashPassword, verifyPassword, generateTotpSecret, verifyTotpCode, generateQrCode } = require('./auth');

const app = express();
app.set('trust proxy', 1); // needed for secure cookies behind Render/Railway's proxy
app.use(express.json());
app.use(express.static('public'));

if (!process.env.SESSION_SECRET) {
  throw new Error('Missing SESSION_SECRET. Set a long random string in your .env file.');
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));

// Basic brute-force protection on login: 5 attempts per username per 5 minutes.
const loginAttempts = new Map(); // username -> [timestamps]
function isRateLimited(username) {
  const now = Date.now();
  const attempts = (loginAttempts.get(username) || []).filter((t) => now - t < 5 * 60 * 1000);
  loginAttempts.set(username, attempts);
  return attempts.length >= 5;
}
function recordFailedAttempt(username) {
  const attempts = loginAttempts.get(username) || [];
  attempts.push(Date.now());
  loginAttempts.set(username, attempts);
}

const PREMIUM_REPORT_PRICE_USD = '9.99';
const PREMIUM_REPORT_PRICE_KES = 1300; // adjust to your pricing

async function finalizeLead(ref) {
  const lead = pendingLeads.get(ref);
  if (!lead || completedReports.has(ref)) return; // unknown ref, or already processed
  const outcome = await processLead(lead);
  completedReports.set(ref, {
    ...outcome,
    premium: {
      recommendedNextStep:
        outcome.result.path === 'priority-outreach'
          ? 'Call within 24 hours — enterprise-tier lead'
          : 'Enroll in 5-email nurture sequence',
      confidence: outcome.result.score >= 70 ? 'high' : 'moderate',
    },
  });
  pendingLeads.delete(ref);
}
// ---- Step 1: submit a lead, get a payment reference back ----
app.post('/api/lead', async (req, res) => {
  const { name, email, phone, method } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Missing name or email' });

  try {
    if (method === 'paypal') {
      const leadRef = crypto.randomUUID();
      const createReq = new checkoutNodeJssdk.orders.OrdersCreateRequest();
      createReq.prefer('return=representation');
      createReq.requestBody({
        intent: 'CAPTURE',
        purchase_units: [
          {
            description: 'Premium lead report',
            custom_id: leadRef, // lets the webhook find this lead later
            amount: { currency_code: 'USD', value: PREMIUM_REPORT_PRICE_USD },
          },
        ],
        application_context: {
          return_url: `${req.protocol}://${req.get('host')}/?paypal_return=1`,
          cancel_url: `${req.protocol}://${req.get('host')}/?paypal_cancel=1`,
        },
      });
      const order = await client().execute(createReq);
      pendingLeads.set(order.result.id, { name, email });
      pendingLeads.set(leadRef, { name, email }); // webhook may only have leadRef

      const approveUrl = order.result.links?.find((l) => l.rel === 'approve')?.href;
      return res.json({ status: 'created', method: 'paypal', orderId: order.result.id, approveUrl });
    }

    if (method === 'mpesa') {
      if (!phone || !/^254\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'phone must be in 2547XXXXXXXX format' });
      }
      const stk = await initiateSTKPush({
        phone,
        amount: PREMIUM_REPORT_PRICE_KES,
        accountReference: 'PremiumLeadReport',
        description: 'Premium lead report',
      });
      pendingLeads.set(stk.CheckoutRequestID, { name, email, phone });
      return res.json({
        status: 'pending',
        method: 'mpesa',
        checkoutRequestId: stk.CheckoutRequestID,
        customerMessage: stk.CustomerMessage,
      });
    }

    return res.status(400).json({ error: "method must be 'paypal' or 'mpesa'" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PayPal: manual capture path (buyer approved, your frontend calls this on return) ----
app.post('/payments/capture-order/:orderId', async (req, res) => {
  try {
    const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(req.params.orderId);
    request.requestBody({});
    const capture = await client().execute(request);

    if (capture.result.status === 'COMPLETED') {
      await finalizeLead(req.params.orderId);
    }
    res.json({ status: capture.result.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- PayPal: webhook path (more reliable — fires even if the buyer never returns to your site) ----
// Register this URL under your app's webhooks in the PayPal developer dashboard,
// subscribed to the PAYMENT.CAPTURE.COMPLETED event, and set PAYPAL_WEBHOOK_ID
// to the ID it gives you. Every event is verified against PayPal before being trusted.
app.post('/payments/paypal/webhook', async (req, res) => {
  try {
    const isValid = await verifyWebhookSignature(req.headers, req.body);
    if (!isValid) {
      console.warn('Rejected PayPal webhook: signature verification failed');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
  } catch (err) {
    console.error('Webhook verification error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  const event = req.body || {};
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const leadRef = event.resource?.custom_id;
    if (leadRef) await finalizeLead(leadRef);
  }
  res.json({ received: true });
});

// ---- M-Pesa: Safaricom calls this once the user approves/declines the STK prompt ----
// Set MPESA_CALLBACK_URL to a public URL that routes here (e.g. via ngrok in dev).
app.post('/payments/mpesa/callback', async (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  if (stkCallback?.ResultCode === 0) {
    await finalizeLead(stkCallback.CheckoutRequestID);
  }
  // Safaricom just needs a 200 acknowledging receipt — no payload required.
  res.json({ ResultCode: 0, ResultDesc: 'Received' });
});

// ---- Step 2: fetch the report once payment has been confirmed ----
app.get('/leads/report/:ref', (req, res) => {
  const report = completedReports.get(req.params.ref);
  if (report) return res.json(report);
  if (pendingLeads.has(req.params.ref)) {
    return res.status(202).json({ status: 'pending', message: 'Payment not yet confirmed' });
  }
  res.status(404).json({ error: 'Unknown reference' });
});

// ---- Free tier: run the pipeline without payment ----
app.post('/leads', async (req, res) => {
  try {
    const outcome = await processLead(req.body);
    res.json(outcome);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Dashboard auth: username + password + TOTP 2FA ----
// First account ever created has no gate (bootstrapping the owner account).
// After that, only an already-logged-in user can create new accounts —
// registration is not open to the public.
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
  }

  const isFirstUser = users.count() === 0;
  if (!isFirstUser && !req.session?.userId) {
    return res.status(401).json({ error: 'Only an existing logged-in user can create new accounts' });
  }

  if (users.findByUsername(username)) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const totpSecret = generateTotpSecret();
    const userId = users.create(username, passwordHash, totpSecret);
    const qrCodeDataUrl = await generateQrCode(username, totpSecret);
    res.json({ userId, username, qrCodeDataUrl, manualEntryKey: totpSecret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/auth/verify-setup', (req, res) => {
  const { username, code } = req.body || {};
  const user = users.findByUsername(username);
  if (!user) return res.status(404).json({ error: 'Unknown username' });
  if (!verifyTotpCode(code, user.totp_secret)) {
    return res.status(400).json({ error: 'Invalid code — check your authenticator app and try again' });
  }
  users.enableTotp(user.id);
  res.json({ status: 'verified' });
});

app.post('/auth/login', async (req, res) => {
  const { username, password, totpCode } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  if (isRateLimited(username)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const user = users.findByUsername(username);
  if (!user) {
    recordFailedAttempt(username);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    recordFailedAttempt(username);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!user.totp_enabled) {
    return res.status(403).json({ error: '2FA setup not completed for this account', needsSetup: true });
  }

  if (!totpCode || !verifyTotpCode(totpCode, user.totp_secret)) {
    recordFailedAttempt(username);
    return res.status(401).json({ error: 'Invalid 2FA code' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ status: 'ok', username: user.username });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ status: 'logged out' }));
});

app.get('/auth/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ username: req.session.username });
});

app.get('/api/leads', requireAuth, (req, res) => {
  res.json({ leads: leads.listAll() });
});

app.patch('/api/leads/:ref/followup', requireAuth, (req, res) => {
  const { status, notes } = req.body || {};
  const allowed = ['new', 'contacted', 'won', 'lost'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });
  }
  leads.setFollowup(req.params.ref, status, notes);
  res.json({ status: 'saved' });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lead agent API listening on port ${PORT}`));
