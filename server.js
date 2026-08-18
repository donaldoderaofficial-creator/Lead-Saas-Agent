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

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const compression = require('compression');

// Scalability & Configuration
const { config, isFeatureEnabled } = require('./config');
const { logger, requestLogger, errorHandler, asyncHandler } = require('./logger');
const { cache, withCache } = require('./cache');
const { RateLimiter } = require('./rate-limiter');

// Core modules
const { client, checkoutNodeJssdk, verifyWebhookSignature } = require('./paypal-client');
const { generateDynamicQrCode, initiateSTKPush } = require('./mpesa-client');
const { processLead } = require('./lead-pipeline');
const { pendingLeads, completedReports, payments, leads, users, createSessionStore } = require('./store');
const { hashPassword, verifyPassword, generateTotpSecret, verifyTotpCode, generateQrCode } = require('./auth');
const { fetchBusinesses, findPersonContact, fetchProspectsAtCompanies } = require('./explorium-client');

const app = express();
const DISPATCH_PRO = config.company;

// ---- Middleware: Performance & Scalability ----
if (config.performance.enableCompression) {
  app.use(compression()); // GZIP compression for efficient data transfer
}

app.use(requestLogger); // Request logging for monitoring
app.set('trust proxy', config.isProd ? 1 : false);
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  const requestOrigin = req.get('origin');
  if (!requestOrigin) return next();
  if (!config.security.corsOrigins.includes(requestOrigin)) {
    return res.status(403).json({ error: 'Origin is not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- Session Configuration ----
if (!config.sessionSecret) {
  throw new Error('Missing SESSION_SECRET. Set a long random string in your .env file.');
}

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: createSessionStore(session),
  cookie: {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: config.security.tokenExpiry,
  },
}));

// ---- Rate Limiting: Profitability & Security ----
const rateLimiter = new RateLimiter();
const loginAttempts = new Map(); // username -> [timestamps]

function isRateLimited(username, req) {
  return rateLimiter.isLimited(
    `${req.ip}:${username}`,
    config.rateLimiting.loginAttempts,
    config.rateLimiting.loginWindowMs
  );
}

function recordFailedAttempt(username, req) {
  // Rate limiter tracks this automatically
  logger.warn(`Failed login attempt for user: ${username}`, { ip: req.ip });
}

// Flexible, configurable pricing from config system
const PRICING = config.pricing;

// ---- Health Check Endpoint ----
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ---- Metrics & Monitoring Endpoint (Admin Only) ----
app.get('/metrics', requireAuth, (req, res) => {
  res.json({
    logger: logger.getMetrics(),
    cache: cache.stats(),
    rateLimiter: rateLimiter.userLimits.size,
  });
});

async function finalizeLead(ref, payment) {
  const lead = pendingLeads.get(ref);
  if (!lead || completedReports.has(ref)) return; // unknown ref, or already processed
  if (payment) payments.record({ ...payment, reference: ref });
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
            amount: { currency_code: 'USD', value: PRICING.usd.starter.price },
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
        amount: PRICING.kes.starter.price,
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

// ---- M-Pesa: generate a dynamic QR code for merchant checkout ----
app.post('/payments/mpesa/qr', async (req, res) => {
  if (rateLimiter.isLimited(`mpesa-qr:${req.ip}`, 30, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many QR requests. Try again later.' });
  }

  const { reference, amount, transactionCode = 'PB', size = 300 } = req.body || {};
  try {
    const qr = await generateDynamicQrCode({
      merchantName: DISPATCH_PRO.brand,
      reference,
      amount,
      transactionCode,
      size,
      cpi: config.payment.mpesa.shortCode,
    });
    res.json({ method: 'mpesa-qr', ...qr });
  } catch (err) {
    logger.error('M-Pesa QR generation failed', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// ---- PayPal: manual capture path (buyer approved, your frontend calls this on return) ----
app.post('/payments/capture-order/:orderId', async (req, res) => {
  try {
    const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(req.params.orderId);
    request.requestBody({});
    const capture = await client().execute(request);

    if (capture.result.status === 'COMPLETED') {
      await finalizeLead(req.params.orderId, {
        provider: 'paypal',
        transactionId: req.params.orderId,
        amount: capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0,
        currency: capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code || 'USD',
        raw: capture.result,
      });
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
    if (leadRef) await finalizeLead(leadRef, {
      provider: 'paypal',
      transactionId: event.resource?.id || leadRef,
      amount: event.resource?.amount?.value || 0,
      currency: event.resource?.amount?.currency_code || 'USD',
      raw: event,
    });
  }
  res.json({ received: true });
});

// ---- M-Pesa: Safaricom calls this once the user approves/declines the STK prompt ----
// Set MPESA_CALLBACK_URL to a public URL that routes here (e.g. via ngrok in dev).
app.post('/payments/mpesa/callback', async (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  if (stkCallback?.ResultCode === 0) {
    const metadata = stkCallback.CallbackMetadata?.Item || [];
    const value = (name) => metadata.find((item) => item.Name === name)?.Value;
    await finalizeLead(stkCallback.CheckoutRequestID, {
      provider: 'mpesa-stk',
      transactionId: value('MpesaReceiptNumber') || stkCallback.CheckoutRequestID,
      amount: value('Amount') || 0,
      currency: 'KES',
      raw: req.body,
    });
  }
  // Safaricom just needs a 200 acknowledging receipt — no payload required.
  res.json({ ResultCode: 0, ResultDesc: 'Received' });
});

// ---- M-Pesa: C2B confirmation for QR and other merchant payments ----
app.post('/payments/mpesa/c2b/validation', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.post('/payments/mpesa/c2b/confirmation', async (req, res) => {
  const payment = req.body || {};
  const expectedShortCode = config.payment.mpesa.shortCode;
  const merchantMatches = expectedShortCode
    && String(payment.BusinessShortCode || '') === String(expectedShortCode);
  if (merchantMatches && payment.TransID && payment.BillRefNumber && Number(payment.TransAmount) > 0) {
    await finalizeLead(payment.BillRefNumber, {
      provider: 'mpesa-c2b',
      transactionId: payment.TransID,
      amount: payment.TransAmount,
      currency: 'KES',
      raw: payment,
    });
  }
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
    res.json({
      userId,
      username,
      qrCodeDataUrl,
      manualEntryKey: totpSecret,
      companyProfile: DISPATCH_PRO,
    });
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

  if (isRateLimited(username, req)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const user = users.findByUsername(username);
  if (!user) {
    recordFailedAttempt(username, req);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    recordFailedAttempt(username, req);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!user.totp_enabled) {
    return res.status(403).json({ error: '2FA setup not completed for this account', needsSetup: true });
  }

  if (!totpCode || !verifyTotpCode(totpCode, user.totp_secret)) {
    recordFailedAttempt(username, req);
    return res.status(401).json({ error: 'Invalid 2FA code' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.companyProfile = DISPATCH_PRO;
  res.json({ status: 'ok', username: user.username, companyProfile: DISPATCH_PRO });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ status: 'logged out' }));
});

app.get('/auth/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not logged in' });
  req.session.companyProfile = req.session.companyProfile || DISPATCH_PRO;
  res.json({
    username: req.session.username,
    companyProfile: req.session.companyProfile,
    founder: DISPATCH_PRO.founder,
    founderTitle: DISPATCH_PRO.title,
  });
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

// ---- Prospecting: company/prospect data via Explorium, costs real credits per call ----
// All gated behind dashboard login — this is a paid feature, not public.

app.post('/api/prospecting/companies', requireAuth, async (req, res) => {
  try {
    const result = await fetchBusinesses(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prospecting/person', requireAuth, async (req, res) => {
  const { fullName, companyName, email } = req.body || {};
  if (!email && !(fullName && companyName)) {
    return res.status(400).json({ error: 'Provide either email, or fullName + companyName' });
  }
  try {
    const result = await findPersonContact({ fullName, companyName, email });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prospecting/company-prospects', requireAuth, async (req, res) => {
  const { businessIds } = req.body || {};
  if (!Array.isArray(businessIds) || businessIds.length === 0) {
    return res.status(400).json({ error: 'businessIds must be a non-empty array of Explorium business IDs' });
  }
  try {
    const result = await fetchProspectsAtCompanies(req.body);
    res.json(result);
  } catch (err) {
    logger.error(`Error in prospecting endpoint: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---- Error Handling Middleware (Maintainability & Resilience) ----
app.use(errorHandler);

// ---- Server Startup ----
const PORT = config.port;
const HOST = config.host;

const server = app.listen(PORT, HOST, () => {
  logger.info(`Dispatch Pro API listening on ${HOST}:${PORT}`, {
    env: config.env,
    isProd: config.isProd,
  });
});

// ---- Graceful Shutdown (Resilience) ----
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  process.exit(1);
});

module.exports = app;
