'use strict';

const crypto = require('node:crypto');
const { getCryptoUsdRate } = require('./crypto-rates');
const { config } = require('./config');

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

function formatWalletInstructions(quote) {
  const bitcoin = config.wallets.bitcoin.address
    ? `BTC: send ${quote.conversions.BTC} BTC to ${config.wallets.bitcoin.address}`
    : 'BTC payments are not configured yet';
  const ethereum = config.wallets.ethereum.address
    ? `ETH: send ${quote.conversions.ETH} ETH to ${config.wallets.ethereum.address}`
    : 'ETH payments are not configured yet';
  return `${bitcoin}. ${ethereum}. Payment proof is reviewed manually before access is enabled. Double-check the network and address before sending; crypto transfers cannot be reversed.`;
}

function extractLeadVolume(text) {
  const match = String(text || '').match(/(\d[\d,]{1,6})\s*(?:leads?|contacts?|inquiries|enquiries|prospects|signups?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function recommendPlanForVolume(volume) {
  if (volume == null) return null;
  return volume > config.pricing.usd.starter.leads ? 'growth' : 'starter';
}

function describePlan(planKey) {
  const plan = config.pricing.usd[planKey];
  const label = planKey === 'growth' ? 'Growth' : 'Starter';
  return `${label} covers up to ${plan.leads.toLocaleString()} leads/month at $${plan.price}/mo`;
}

function closeWithNextStep(planKey) {
  if (planKey) return `Start on ${planKey === 'growth' ? 'Growth' : 'Starter'}: /billing.html?plan=${planKey}.`;
  return 'Which plan should I quote?';
}

function buildMiaReply(question) {
  const text = String(question || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Mia, Dispatch Pro. Ask about plans, lead qualification, integrations, or BTC/ETH payment quotes.';

  if (/custom|enterprise|scale|10,?000|large package/.test(lower)) {
    const quote = quoteCustomPackage({ currency: inferCurrency(text), budgetUsd: inferBudget(text) });
    return `Custom package starts at ${formatCryptoAmount(quote)} for ${CUSTOM_TERM_MONTHS} months. ${formatWalletInstructions(quote)} For a scoped proposal, send user count, monthly lead volume, required integrations, timeline, and settlement currency.`;
  }

  if (/expensive|too much|can'?t afford|cheaper|discount|budget/.test(lower)) {
    return `${describePlan('starter')}. Start on Starter, then move to Growth if volume exceeds its cap. ${closeWithNextStep('starter')}`;
  }

  if (/already (?:have|use|using)|current (?:tool|crm|system)|competitor|switching from|another (?:tool|platform|vendor)/.test(lower)) {
    return `Dispatch Pro scores and routes inbound leads, with decisions visible on the dashboard. What is the biggest gap in your current setup?`;
  }

  if (/think about it|not (?:sure|ready)|later|maybe (?:next|another)|need time|talk to my team/.test(lower)) {
    return `Starter is billed monthly. ${closeWithNextStep('starter')} What concern should I address before you decide?`;
  }

  if (/secure|security|safe|trust|data privacy|gdpr/.test(lower)) {
    return 'Current controls: hashed passwords, 2FA, secure production cookies, and rate-limited access. Which control should I explain?';
  }

  if (/btc|bitcoin|eth|ethereum|crypto|pay/.test(lower)) return 'BTC and ETH wallet payments are accepted. Quotes use live rates; payment proof is reviewed before access. Which plan do you need quoted?';

  if (/starter|growth|plan|pricing|cost/.test(lower)) {
    const volume = extractLeadVolume(lower);
    const recommendation = recommendPlanForVolume(volume);
    if (recommendation) {
      return `With about ${volume.toLocaleString()} leads a month, ${recommendation === 'growth' ? 'Growth' : 'Starter'} is the better fit — ${describePlan(recommendation)}${recommendation === 'growth' ? ', plus unlimited sources and priority support' : ''}. ${closeWithNextStep(recommendation)}`;
    }
    return `${describePlan('starter')}. ${describePlan('growth')} with priority support and custom qualification logic. How many leads do you receive monthly?`;
  }

  if (/lead|qualif|dashboard|workflow|integration/.test(lower)) return 'Dispatch Pro captures, qualifies, and tracks inbound leads. Which source or integration do you need?';
  if (/thank|thanks|appreciate/.test(lower)) return 'You are welcome. What is the next question?';
  if (/hello|hi|hey|good morning|good afternoon/.test(lower)) return 'Mia, Dispatch Pro. What do you need help with?';
  return 'I can help with plans, lead qualification, integrations, and BTC/ETH quotes. What outcome do you need?';
}

function buildCustomReply({ body = '', subject = '' } = {}) {
  const quote = quoteCustomPackage({ currency: inferCurrency(body), budgetUsd: inferBudget(body) });
  const reply = `Hello,\n\nCustom package estimate: ${formatCryptoAmount(quote)} for ${CUSTOM_TERM_MONTHS} months. This is an estimate, not a payment request or financial advice; final scope and terms require discovery.\n\nReply with user count, monthly lead volume, integrations, timeline, and preferred currency (BTC or ETH) for a written proposal.\n\nDispatch Pro\n${process.env.EMAIL_FROM || 'hello@dispatchpro.ai'}`;
  return { reply, quote, subject: subject || 'Custom package enquiry' };
}

async function improveReplyWithAI(draft) {
  if (!process.env.OPENAI_API_KEY) return draft;
  const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.2, messages: [
      { role: 'system', content: 'You are Dispatch Pro customer support. Return only the concise, decision-relevant email body, with no more than 120 words. Remove filler, repeated context, greetings, and generic calls to action. Do not change prices, currencies, disclaimers, or promise outcomes. Do not provide financial advice.' },
      { role: 'user', content: draft.reply },
    ] }),
  });
  if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
  const content = (await response.json()).choices?.[0]?.message?.content?.trim();
  if (!content) return draft;
  const wordCount = content.split(/\s+/).length;
  if (wordCount > 120 || /\b(?:I hope this (?:email|message) finds you well|thank you for reaching out|please do not hesitate to reach out)\b/i.test(content)) {
    throw new Error('AI response did not meet the concise reply requirements');
  }
  return { ...draft, reply: content };
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function sendReply({ to, subject, text, replyTo, prefixSubject = true, headers }) {
  if (process.env.EMAIL_AUTOREPLY_ENABLED !== 'true') return { sent: false, reason: 'EMAIL_AUTOREPLY_ENABLED is not true' };
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when email auto-replies are enabled');
  const message = {
    from: process.env.EMAIL_FROM || 'Dispatch Pro <hello@dispatchpro.ai>',
    to: [to],
    subject: `${prefixSubject ? 'Re: ' : ''}${subject}`,
    text,
  };
  if (replyTo) message.reply_to = replyTo;
  if (headers) message.headers = headers;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`email provider returned HTTP ${response.status}`);
  return { sent: true, provider: 'resend', id: (await response.json()).id || null };
}

module.exports = { buildCustomReply, buildMiaReply, improveReplyWithAI, verifyWebhookSignature, sendReply, MINIMUM_CUSTOM_USD, CUSTOM_TERM_MONTHS };
