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
const path = require('node:path');
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
const { pendingLeads, completedReports, payments, leads, records, users, subscription, createSessionStore } = require('./store');
const { hasActiveSubscription } = require('./subscription-policy');
const { hashPassword, verifyPassword, generateTotpSecret, verifyTotpCode, generateQrCode } = require('./auth');
const { fetchBusinesses, findPersonContact, fetchProspectsAtCompanies } = require('./explorium-client');

const app = express();
const DISPATCH_PRO = config.company;

function matchesAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return regex.test(origin);
    }
    return origin === pattern;
  });
}

function isOriginAllowed(origin, path = '') {
  if (!origin) return true;
  if (matchesAllowedOrigin(origin, config.security.corsOrigins)) return true;

  try {
    const { hostname } = new URL(origin);
    const isLocalDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
    if (isLocalDevelopmentHost) return true;
    if (path.startsWith('/api/ebook/') || path.startsWith('/ebook/')) {
      return hostname.endsWith('.netlify.app') || hostname.endsWith('.vercel.app') || hostname.endsWith('.pages.dev');
    }
  } catch (_) {
    return false;
  }

  return false;
}

app.isOriginAllowed = isOriginAllowed;

// ---- Middleware: Performance & Scalability ----
if (config.performance.enableCompression) {
  app.use(compression()); // GZIP compression for efficient data transfer
}

app.use(requestLogger); // Request logging for monitoring
app.set('trust proxy', config.isProd ? 1 : false);
app.use(express.json());

app.use((req, res, next) => {
  const legacyEbookPaths = ['/ebook-success.html', '/ebook-reader.html', '/ebook/access', '/ebook/download.pdf', '/ebook/read'];
  if (legacyEbookPaths.includes(req.path)) {
    return res.redirect(302, '/ebook.html');
  }
  next();
});

app.use(express.static('public'));

app.use((req, res, next) => {
  const requestOrigin = req.get('origin');
  if (!requestOrigin) return next();
  if (!app.isOriginAllowed(requestOrigin, req.path)) {
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
const EBOOK_PRICE_USD = Number(config.ebook?.priceUsd || 19.99);
const BTC_USD_PRICE = Number(process.env.BTC_USD_PRICE || 70000);

function getEbookBtcAmount() {
  if (!Number.isFinite(BTC_USD_PRICE) || BTC_USD_PRICE <= 0) return '0.00025700';
  const btcValue = EBOOK_PRICE_USD / BTC_USD_PRICE;
  return btcValue < 0.000257 ? '0.00025700' : btcValue.toFixed(8);
}

function buildEbookCheckoutPayload({ name, email, reference } = {}) {
  const amountUsd = Number(config.ebook?.priceUsd || 19.99);
  const amountBtc = getEbookBtcAmount();
  const walletAddress = config.ebook?.walletAddress || config.wallets.bitcoin.address || '3EiZ7FZ5r8LB9rdKWmhei5MsErPj58dK3k';
  const buyerName = name || 'Customer';
  const orderReference = reference || crypto.randomUUID();

  return {
    status: 'pending',
    reference: orderReference,
    product: config.ebook?.title || "The Builder's Blueprint",
    buyerName,
    buyerEmail: email || 'wallet-customer@not-provided.local',
    amountUsd,
    amountBtc,
    walletAddress,
    instructions: `Copy this wallet address: ${walletAddress}. Send exactly ${amountBtc} BTC (about $${amountUsd.toFixed(2)} USD) to it, then paste the transaction hash here to unlock your ebook.`,
  };
}

app.buildEbookCheckoutPayload = buildEbookCheckoutPayload;

// ---- Health Check Endpoint ----
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ---- Global payment capabilities ----
app.get('/api/payments/options', (req, res) => {
  res.json({
    providers: {
      paypal: {
        enabled: config.payment.paypal.enabled,
        currency: 'USD',
        methods: ['checkout'],
      },
      mpesa: {
        enabled: config.payment.mpesa.enabled,
        currency: 'KES',
        methods: ['stk-push', 'dynamic-qr'],
      },
      bitcoin: {
        enabled: !!config.wallets.bitcoin.address,
        currency: 'BTC',
        methods: ['wallet-transfer'],
        address: config.wallets.bitcoin.address,
      },
      ethereum: {
        enabled: !!config.wallets.ethereum.address,
        currency: 'ETH',
        methods: ['wallet-transfer'],
        address: config.wallets.ethereum.address,
      },
    },
    supportedCurrencies: ['USD', 'KES', 'BTC', 'ETH'],
    settlement: 'Direct Bitcoin and Ethereum wallet transfers are accepted manually and require transaction confirmation before a report is released.',
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    paypalClientId: config.payment.paypal.clientId || null,
    plans: {
      starter: { paypalPlanId: process.env.PAYPAL_PLAN_STARTER_MONTHLY || null },
      growth: { paypalPlanId: process.env.PAYPAL_PLAN_GROWTH_MONTHLY || null },
    },
    ebook: {
      enabled: config.ebook?.enabled,
      title: config.ebook?.title,
      priceUsd: Number(config.ebook?.priceUsd || 19.99),
      walletAddress: config.ebook?.walletAddress || config.wallets.bitcoin.address,
    },
  });
});

app.get('/api/billing/status', (req, res) => {
  res.json(subscription.get());
});

app.get('/api/ebook/product', (req, res) => {
  res.json({
    enabled: config.ebook?.enabled ?? true,
    title: config.ebook?.title || 'The Builder\'s Blueprint',
    subtitle: config.ebook?.subtitle || 'A practical guide to building profitable software products.',
    priceUsd: Number(config.ebook?.priceUsd || 19.99),
    priceBtc: getEbookBtcAmount(),
    walletAddress: config.ebook?.walletAddress || config.wallets.bitcoin.address,
    currency: 'BTC',
    checkoutNote: 'Send the exact BTC amount to the wallet above and confirm the transaction hash to unlock your copy.',
  });
});

app.post('/api/ebook/order', (req, res) => {
  const { name, email } = req.body || {};
  const buyerName = name || 'Customer';
  const buyerEmail = email && email.includes('@') ? email : 'wallet-customer@not-provided.local';
  const reference = crypto.randomUUID();

  pendingLeads.set(reference, {
    name: buyerName,
    email: buyerEmail,
    paymentMethod: 'bitcoin-ebook',
    product: 'ebook',
  });

  res.json(buildEbookCheckoutPayload({
    name: buyerName,
    email: buyerEmail,
    reference,
  }));
});

app.post('/api/ebook/confirm', async (req, res) => {
  const { reference, txHash, screenshotData, screenshotUrl, name, email } = req.body || {};
  if (!reference || (!txHash && !screenshotData && !screenshotUrl)) {
    return res.status(400).json({ error: 'reference and either a txHash or a deposit screenshot are required.' });
  }

  const order = pendingLeads.get(reference);
  if (!order) {
    return res.status(404).json({ error: 'Unknown order reference.' });
  }

  const receipt = {
    type: 'ebook',
    title: config.ebook?.title,
    buyer: {
      name: name || order.name || 'Customer',
      email: email || order.email || 'unknown@example.com',
    },
    amountUsd: Number(config.ebook?.priceUsd || 19.99),
    amountBtc: getEbookBtcAmount(),
    walletAddress: config.ebook?.walletAddress || config.wallets.bitcoin.address,
    txHash: txHash || null,
    screenshotData: screenshotData || null,
    screenshotUrl: screenshotUrl || null,
    status: 'paid',
    purchasedAt: new Date().toISOString(),
  };

  payments.record({
    provider: 'bitcoin-ebook',
    transactionId: txHash || screenshotData || screenshotUrl || reference,
    reference,
    amount: receipt.amountUsd,
    currency: 'USD',
    status: 'pending_review',
    raw: receipt,
  });

  return res.status(202).json({
    status: 'pending_review',
    reference,
    message: 'Payment proof received. Ebook access will be released after payment verification.',
  });
});

const ebookReadLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many ebook access requests, please try again in a minute.' },
});

app.get('/ebook/preview', ebookReadLimiter.middleware(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ebook-preview.html'));
});

app.get('/ebook/success', ebookReadLimiter.middleware(), (req, res) => {
  const reference = req.query.ref;
  const report = completedReports.get(reference);
  if (!report || report.type !== 'ebook') {
    return res.status(404).send('This ebook purchase is not recognized or has not been confirmed yet.');
  }

  res.sendFile(path.join(__dirname, 'public', 'ebook-success.html'));
});

app.get('/ebook/access', ebookReadLimiter.middleware(), (req, res) => {
  const reference = req.query.ref;
  const report = completedReports.get(reference);
  if (!report || report.type !== 'ebook') {
    return res.status(401).send('This page is only available to confirmed ebook buyers.');
  }

  res.sendFile(path.join(__dirname, 'public', 'ebook-reader.html'));
});

app.get('/ebook/read', ebookReadLimiter.middleware(), (req, res) => {
  const reference = req.query.ref;
  const report = completedReports.get(reference);
  if (!report || report.type !== 'ebook') {
    return res.status(401).send('This page is only available to confirmed ebook buyers.');
  }

  res.sendFile(path.join(__dirname, 'public', 'ebook-reader.html'));
});

function buildEbookPdf() {
  const chapters = [
    'Chapter 1: The first time I realized I was not lazy',
    'The first real insight is that confusion is not the same as lack of talent. I was not lazy; I was overwhelmed by too many tutorials, too many ideas, and no system for turning effort into value.',
    'I had to learn that building is not the same as collecting knowledge. The real shift begins when you decide what problem you want to solve, why it matters, and how you will turn your skill into leverage.',
    'Chapter 2: Why talented people still get stuck',
    'Talent can help, but talent without direction becomes noise. Many smart people remain stuck because they build things for attention instead of usefulness. They want approval, not traction.',
    'The most valuable shift is to get honest about what you are making and who it is for. If you can identify the real pain point, the work becomes easier to explain, easier to sell, and easier to trust.',
    'Chapter 3: Build for value, not applause',
    'A project is not a business until it solves a real problem for someone else. This is the hidden rule: people do not buy effort, they buy outcomes.',
    'I stopped asking, “How do I impress people?” and started asking, “How do I make someone’s life easier, faster, or more valuable?” Once I focused on outcomes, my work gained clarity and attention.',
    'Chapter 4: The builder’s system',
    'The builder’s system is simple: decide, validate, ship, learn, iterate. It sounds obvious, but most people get trapped in loops of planning and hesitation.',
    'You do not need a twelve-step framework. You need a way to get from idea to proof quickly. Small experiments create data. Data creates clarity. Clarity creates directional power.',
    'Chapter 5: Turning skill into leverage',
    'Your best long-term skill is not collecting tutorials. It is learning how to turn knowledge into systems that deliver value repeatedly.',
    'That means writing code that matters, designing products that solve real problems, and building assets that compound over time. This is how coding becomes income, and income becomes freedom.',
    'Chapter 6: Pricing, sales, and confidence',
    'Most builders undercharge because they do not understand the value of what they are creating. If your work saves time, reduces stress, or creates outcomes, it is worth more than you think.',
    'The goal is not to sound forceful. It is to be clear. Explain what the work does, why it matters, and why someone should trust it. Clear pricing is part of strong value delivery.',
    'Chapter 7: The long game',
    'The real win is not a single launch. It is building a repeatable process that makes your work more valuable every time you do it.',
    'The builders who last are not necessarily the most talented. They are the ones who stay clear, stay useful, and stay patient enough to make compounding work in their favor.'
  ];

  const text = chapters.join('\n\n');
  const lines = text.split('\n');
  const chunks = [];
  let cursor = 0;
  for (const line of lines) {
    chunks.push(`${cursor} 0 moveto (${line.replace(/[()\\]/g, '\\$&')}) Tj`);
    cursor += 16;
  }

  const content = chunks.join('\n');
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${content.length + 100} >>
stream
BT
/F1 12 Tf
50 760 Td
${content}
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000062 00000 n 
0000000123 00000 n 
0000000845 00000 n 
0000001700 00000 n 
0000002200 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
2280
%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

app.get('/ebook/download.pdf', ebookReadLimiter.middleware(), (req, res) => {
  const reference = req.query.ref;
  const report = completedReports.get(reference);
  if (!report || report.type !== 'ebook') {
    return res.status(401).send('This download is only available to confirmed ebook buyers.');
  }

  const pdf = buildEbookPdf();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="the-builders-blueprint.pdf"');
  res.send(pdf);
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
  if (!hasActiveSubscription(subscription.get())) {
    return res.status(402).json({
      error: 'An active Dispatch Pro package is required before lead services can be used.',
      code: 'subscription_required',
      plansUrl: '/billing.html',
    });
  }
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

    if (['bitcoin', 'ethereum'].includes(method)) {
      const walletType = method === 'bitcoin' ? 'bitcoin' : 'ethereum';
      const walletAddress = config.wallets[walletType].address;
      if (!walletAddress) {
        return res.status(400).json({ error: `Direct ${config.wallets[walletType].label} payments are not configured.` });
      }
      const leadRef = crypto.randomUUID();
      pendingLeads.set(leadRef, { name, email, phone, paymentMethod: method });
      return res.json({
        status: 'pending',
        method,
        reference: leadRef,
        walletAddress,
        amount: PRICING.usd.starter.price,
        currency: config.wallets[walletType].currency,
        instructions: `Send ${config.wallets[walletType].currency} to the wallet address above and then confirm the transaction ID in the follow-up step or through the manual payment confirmation endpoint.`,
      });
    }

    return res.status(400).json({ error: "method must be 'paypal', 'mpesa', 'bitcoin', or 'ethereum'" });
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
  if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const planId = event.resource?.plan_id;
    const plan = planId === process.env.PAYPAL_PLAN_GROWTH_MONTHLY
      ? 'growth'
      : planId === process.env.PAYPAL_PLAN_STARTER_MONTHLY ? 'starter' : null;
    if (plan) {
      subscription.set({
        plan,
        billingType: 'monthly',
        paypalSubscriptionId: event.resource.id,
        status: 'active',
        currentPeriodEnd: event.resource.billing_info?.next_billing_time || null,
      });
    }
  }
  if (['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.SUSPENDED'].includes(event.event_type)) {
    const current = subscription.get();
    if (current.paypalSubscriptionId === event.resource?.id) {
      subscription.set({ ...current, status: event.event_type.endsWith('SUSPENDED') ? 'suspended' : 'cancelled' });
    }
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

app.post('/api/payments/wallet/confirm', async (req, res) => {
  const { reference, txHash, method, amount } = req.body || {};
  if (!reference || !txHash || !method) {
    return res.status(400).json({ error: 'reference, txHash, and method are required' });
  }
  if (!['bitcoin', 'ethereum'].includes(method)) {
    return res.status(400).json({ error: "method must be 'bitcoin' or 'ethereum'" });
  }
  const lead = pendingLeads.get(reference);
  if (!lead) {
    return res.status(404).json({ error: 'Unknown payment reference' });
  }
  await finalizeLead(reference, {
    provider: method,
    transactionId: txHash,
    amount: Number(amount) || PRICING.usd.starter.price,
    currency: config.wallets[method].currency,
    raw: { txHash, method, amount: Number(amount) || PRICING.usd.starter.price },
  });
  res.json({ status: 'confirmed', method, reference, txHash });
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

// ---- Internal lead processing: package gate applies before this route ----
app.post('/leads', async (req, res) => {
  if (!hasActiveSubscription(subscription.get())) {
    return res.status(402).json({
      error: 'An active Dispatch Pro package is required before lead services can be used.',
      code: 'subscription_required',
      plansUrl: '/billing.html',
    });
  }
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

function requireAdmin(req, res, next) {
  const user = users.findById(req.session.userId);
  if (!user || !['owner', 'admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

function requireActiveSubscription(req, res, next) {
  if (!hasActiveSubscription(subscription.get())) {
    return res.status(402).json({
      error: 'An active Dispatch Pro package is required for this service.',
      code: 'subscription_required',
      plansUrl: '/billing.html',
    });
  }
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

app.post('/api/records', requireAuth, requireAdmin, (req, res) => {
  const { title, recordType, classification, owner, retentionUntil, storageUri, checksum, metadata } = req.body || {};
  const classifications = ['public', 'internal', 'confidential', 'restricted'];
  if (!title || typeof title !== 'string' || title.length > 200) {
    return res.status(400).json({ error: 'title is required and must be 200 characters or fewer' });
  }
  if (!recordType || typeof recordType !== 'string' || recordType.length > 100) {
    return res.status(400).json({ error: 'recordType is required and must be 100 characters or fewer' });
  }
  if (!owner || typeof owner !== 'string' || owner.length > 200) {
    return res.status(400).json({ error: 'owner is required and must be 200 characters or fewer' });
  }
  if (classification && !classifications.includes(classification)) {
    return res.status(400).json({ error: `classification must be one of ${classifications.join(', ')}` });
  }
  if (retentionUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(retentionUntil) || Number.isNaN(Date.parse(`${retentionUntil}T00:00:00Z`)))) {
    return res.status(400).json({ error: 'retentionUntil must be a valid YYYY-MM-DD date' });
  }
  if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) {
    return res.status(400).json({ error: 'metadata must be a JSON object' });
  }
  try {
    const record = records.create({
      id: crypto.randomUUID(),
      title,
      recordType,
      classification,
      owner,
      retentionUntil: retentionUntil || null,
      storageUri: storageUri || null,
      checksum: checksum || null,
      metadata: metadata || {},
      createdBy: req.session.userId,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/records', requireAuth, requireAdmin, (req, res) => {
  const allowedStatuses = ['draft', 'active', 'archived', 'disposed'];
  if (req.query.status && !allowedStatuses.includes(req.query.status)) {
    return res.status(400).json({ error: `status must be one of ${allowedStatuses.join(', ')}` });
  }
  res.json({ records: records.list({ status: req.query.status, recordType: req.query.recordType }) });
});

app.get('/api/records/:id/audit', requireAuth, requireAdmin, (req, res) => {
  if (!records.get(req.params.id)) return res.status(404).json({ error: 'Record not found' });
  res.json({ audit: records.listAudit(req.params.id) });
});

app.patch('/api/records/:id/status', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'archived', 'disposed'].includes(status)) {
    return res.status(400).json({ error: 'status must be one of active, archived, disposed' });
  }
  const result = records.transition(req.params.id, status, req.session.userId);
  if (!result.ok) {
    return res.status(result.reason === 'not-found' ? 404 : 409).json({ error: result.reason });
  }
  res.json(result.record);
});

app.post('/api/ebook/review/:reference', requireAuth, requireAdmin, (req, res) => {
  const { approved } = req.body || {};
  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: 'approved must be a boolean' });
  }

  const payment = payments.findByReference(req.params.reference);
  if (!payment || payment.status !== 'pending_review') {
    return res.status(404).json({ error: 'No pending ebook payment review found' });
  }

  payments.updateStatus(payment.id, approved ? 'confirmed' : 'rejected');
  if (!approved) {
    return res.json({ status: 'rejected', reference: req.params.reference });
  }

  const receipt = {
    ...payment.raw,
    status: 'paid',
    verifiedAt: new Date().toISOString(),
    verifiedBy: req.session.username,
  };
  completedReports.set(req.params.reference, receipt);
  pendingLeads.delete(req.params.reference);
  res.json({
    status: 'confirmed',
    reference: req.params.reference,
    accessUrl: `/ebook/access?ref=${encodeURIComponent(req.params.reference)}`,
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

app.post('/api/prospecting/companies', requireAuth, requireActiveSubscription, async (req, res) => {
  try {
    const result = await fetchBusinesses(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prospecting/person', requireAuth, requireActiveSubscription, async (req, res) => {
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

app.post('/api/prospecting/company-prospects', requireAuth, requireActiveSubscription, async (req, res) => {
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

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    logger.info(`Dispatch Pro API listening on ${HOST}:${PORT}`, {
      env: config.env,
      isProd: config.isProd,
    });
  });

  app.server = server;

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

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
