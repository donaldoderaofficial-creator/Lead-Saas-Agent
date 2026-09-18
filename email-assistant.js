'use strict';

const crypto = require('node:crypto');
const { getCryptoUsdRate } = require('./crypto-rates');

const MINIMUM_CUSTOM_USD = Math.max(Number(process.env.CUSTOM_PACKAGE_MIN_USD || 10001), 10001);
const CUSTOM_TERM_MONTHS = 6;

function inferCurrency(text) {
  const value = String(text || '').toUpperCase();
  if (/\b(BTC|BITCOIN)\b/.test(value)) return 'BTC';
  if (/\b(ETH|ETHEREUM)\b/.test(value)) return 'ETH';
  return 'BTC';
}

function inferBudget(text) {
  const match = String(text || '').match(/(?:\$|USD\s*)?(\d[\d,]*(?:\.\d+)?)/i);
  return match ? Number(match[1].replace(/,/g, '')) : MINIMUM_CUSTOM_USD;
}

function quoteCustomPackage({ currency = 'BTC', budgetUsd = MINIMUM_CUSTOM_USD } = {}) {
  const usd = Math.max(Number(budgetUsd) || MINIMUM_CUSTOM_USD, MINIMUM_CUSTOM_USD);
  const selected = ['BTC', 'ETH'].includes(String(currency).toUpperCase()) ? String(currency).toUpperCase() : 'BTC';
  const btcRate = getCryptoUsdRate('bitcoin');
  const ethRate = getCryptoUsdRate('ethereum');
  const rate = selected === 'BTC' ? btcRate : ethRate;
  return {
    usd,
    termMonths: CUSTOM_TERM_MONTHS,
    currency: selected,
    amount: (usd / rate.rate).toFixed(selected === 'BTC' ? 8 : 6),
    recommendedCurrency: selected,
    conversions: { BTC: (usd / btcRate.rate).toFixed(8), ETH: (usd / ethRate.rate).toFixed(6) },
    rate,
    rates: { BTC: btcRate, ETH: ethRate },
  };
}

function formatCryptoAmount(quote) {
  return `${quote.conversions[quote.recommendedCurrency]} ${quote.recommendedCurrency} recommended, or ${quote.conversions.BTC} BTC / ${quote.conversions.ETH} ETH at live market rates`;
}

function buildMiaReply(question) {
  const text = String(question || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Hi, I am Mia from Dispatch Pro. I am happy to help. Ask me about plans, custom packages, lead workflows, or BTC and ETH payments.';
  if (/custom|enterprise|scale|10,?000|large package/.test(lower)) {
    const quote = quoteCustomPackage({ currency: inferCurrency(text), budgetUsd: inferBudget(text) });
    return `That sounds like an exciting opportunity. The current custom-package starting estimate is ${formatCryptoAmount(quote)} total for a ${CUSTOM_TERM_MONTHS}-month engagement. Final scope is confirmed after discovery. What are your users, monthly lead volume, integrations, timeline, and preferred currency? You can also reach our team at hello@dispatchpro.ai.`;
  }
  if (/btc|bitcoin|eth|ethereum|crypto|pay/.test(lower)) return 'Absolutely. Dispatch Pro accepts BTC and ETH wallet payments. Starter and Growth quotes use live market rates, and payment proof is reviewed before access is enabled. Would you like a current Starter, Growth, or custom-package quote?';
  if (/starter|growth|plan|pricing/.test(lower)) return 'I can help you compare them. Starter suits teams beginning their pipeline, while Growth supports larger lead volume, more sources, priority support, and custom qualification logic. How many leads do you expect each month?';
  if (/lead|qualif|dashboard|workflow|integration/.test(lower)) return 'That is exactly the kind of workflow Dispatch Pro is built for. It captures inbound leads, qualifies them with structured business signals, and keeps follow-up work visible in one dashboard. Which sources or integrations do you need first?';
  if (/thank|thanks|appreciate/.test(lower)) return 'You are very welcome. I am glad to help. What would you like to explore next?';
  if (/hello|hi|hey|good morning|good afternoon/.test(lower)) return 'Hello, it is lovely to meet you. I am Mia from Dispatch Pro. What would you like to accomplish?';
  return 'I want to make sure I point you in the right direction. I can help with plans, lead qualification, custom packages, crypto payment quotes, and next steps. What outcome matters most to your team?';
}

function buildCustomReply({ body = '', subject = '' } = {}) {
  const quote = quoteCustomPackage({ currency: inferCurrency(body), budgetUsd: inferBudget(body) });
  const reply = `Hello,\n\nThank you for contacting Dispatch Pro about a custom package. Based on your message, our starting custom-package estimate is ${formatCryptoAmount(quote)} total for a ${CUSTOM_TERM_MONTHS}-month engagement. The final scope and commercial terms will be confirmed after a discovery call; this is an estimate, not a payment request or financial advice.\n\nPlease reply with your target users, monthly lead volume, required integrations, timeline, and preferred settlement currency: BTC or ETH. We will prepare a written proposal aligned with our mission and vision.\n\nBest regards,\nDispatch Pro\n${process.env.EMAIL_FROM || 'hello@dispatchpro.ai'}`;
  return { reply, quote, subject: subject || 'Custom package enquiry' };
}

async function improveReplyWithAI(draft) {
  if (!process.env.OPENAI_API_KEY) return draft;
  const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.2, messages: [
      { role: 'system', content: 'You are Dispatch Pro customer support. Improve clarity and warmth only. Do not change prices, currencies, disclaimers, or promise outcomes. Do not provide financial advice. Return only the email body.' },
      { role: 'user', content: draft.reply },
    ] }),
  });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const content = (await response.json()).choices?.[0]?.message?.content?.trim();
  return content ? { ...draft, reply: content } : draft;
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function sendReply({ to, subject, text, replyTo, prefixSubject = true }) {
  if (process.env.EMAIL_AUTOREPLY_ENABLED !== 'true') return { sent: false, reason: 'EMAIL_AUTOREPLY_ENABLED is not true' };
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when email auto-replies are enabled');
  const message = {
    from: process.env.EMAIL_FROM || 'Dispatch Pro <hello@dispatchpro.ai>',
    to: [to],
    subject: `${prefixSubject ? 'Re: ' : ''}${subject}`,
    text,
  };
  if (replyTo) message.reply_to = replyTo;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`email provider returned HTTP ${response.status}`);
  return { sent: true, provider: 'resend', id: (await response.json()).id || null };
}

module.exports = { buildCustomReply, buildMiaReply, improveReplyWithAI, verifyWebhookSignature, sendReply, MINIMUM_CUSTOM_USD, CUSTOM_TERM_MONTHS };
