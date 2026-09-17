'use strict';

const crypto = require('node:crypto');
const { getCryptoUsdRate } = require('./crypto-rates');

const MINIMUM_CUSTOM_USD = Math.max(Number(process.env.CUSTOM_PACKAGE_MIN_USD || 10001), 10001);

function inferCurrency(text) {
  const value = String(text || '').toUpperCase();
  if (/\b(BTC|BITCOIN)\b/.test(value)) return 'BTC';
  if (/\b(ETH|ETHEREUM)\b/.test(value)) return 'ETH';
  return 'USD';
}

function inferBudget(text) {
  const match = String(text || '').match(/(?:\$|USD\s*)?(\d[\d,]*(?:\.\d+)?)/i);
  return match ? Number(match[1].replace(/,/g, '')) : MINIMUM_CUSTOM_USD;
}

function quoteCustomPackage({ currency = 'USD', budgetUsd = MINIMUM_CUSTOM_USD } = {}) {
  const usd = Math.max(Number(budgetUsd) || MINIMUM_CUSTOM_USD, MINIMUM_CUSTOM_USD);
  const selected = ['USD', 'BTC', 'ETH'].includes(String(currency).toUpperCase())
    ? String(currency).toUpperCase()
    : 'USD';
  const rate = selected === 'BTC' ? getCryptoUsdRate('bitcoin') : selected === 'ETH' ? getCryptoUsdRate('ethereum') : null;
  const amount = selected === 'USD' ? usd : usd / rate.rate;
  return {
    usd,
    currency: selected,
    amount: selected === 'USD' ? usd.toFixed(2) : amount.toFixed(selected === 'BTC' ? 8 : 6),
    rate,
  };
}

function buildCustomReply({ body = '', subject = '' } = {}) {

  function buildMiaReply(question) {
    const text = String(question || '').trim();
    const lower = text.toLowerCase();
    if (!text) return 'Hi, I am Mia from Dispatch Pro. Ask me about plans, custom packages, lead workflows, or paying in BTC or ETH.';
    if (/custom|enterprise|scale|10,?000|large package/.test(lower)) {
      const currency = inferCurrency(text);
      const quote = quoteCustomPackage({ currency, budgetUsd: inferBudget(text) });
      const amount = quote.currency === 'USD' ? `$${quote.amount} USD` : `${quote.amount} ${quote.currency} (about $${quote.usd.toFixed(2)} USD at the current market rate)`;
      return `For a custom Dispatch Pro package, the current starting estimate is ${amount}. Custom scope is confirmed after discovery, and the minimum package value is $${MINIMUM_CUSTOM_USD.toLocaleString()} USD. Tell me your users, monthly lead volume, integrations, timeline, and preferred currency, or email hello@dispatchpro.ai.`;
    }
    if (/btc|bitcoin|eth|ethereum|crypto|pay/.test(lower)) {
      return 'Dispatch Pro accepts BTC and ETH wallet payments. Starter and Growth quotes are calculated from live market rates, and payment proof is reviewed before access is enabled. Visit the billing page to request a current quote.';
    }
    if (/starter|growth|plan|pricing/.test(lower)) {
      return 'Starter is for teams beginning their pipeline, while Growth supports larger lead volume, more sources, priority support, and custom qualification logic. You can compare and select a package on the billing page.';
    }
    if (/lead|qualif|dashboard|workflow|integration/.test(lower)) {
      return 'Dispatch Pro captures inbound leads, qualifies them with structured business signals, and keeps follow-up work visible in one operational dashboard. Mia can help route a custom request to the team.';
    }
    return 'I can help with Dispatch Pro plans, lead qualification, custom packages, crypto payment quotes, and next steps. What are you trying to accomplish?';
  }
  const quote = quoteCustomPackage({ currency: inferCurrency(body), budgetUsd: inferBudget(body) });
  const amount = quote.currency === 'USD'
    ? `$${quote.amount} USD`
    : `${quote.amount} ${quote.currency} (approximately $${quote.usd.toFixed(2)} USD at the current market rate)`;
  const reply = `Hello,\n\nThank you for contacting Dispatch Pro about a custom package. Based on your message, our starting custom-package estimate is ${amount}. The final scope and commercial terms will be confirmed after a discovery call; this is an estimate, not a payment request or financial advice.\n\nPlease reply with your target users, monthly lead volume, required integrations, timeline, and preferred settlement currency: BTC, ETH, or USD. We will prepare a written proposal aligned with our mission to help businesses grow through practical technology and lead intelligence, and our vision of reliable, responsible automation.\n\nBest regards,\nDispatch Pro\n${process.env.EMAIL_FROM || 'hello@dispatchpro.ai'}`;
  return { reply, quote, subject: subject || 'Custom package enquiry' };
}

async function improveReplyWithAI(draft) {
  if (!process.env.OPENAI_API_KEY) return draft;
  const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are Dispatch Pro customer support. Improve clarity and warmth only. Do not change prices, currencies, disclaimers, or promise outcomes. Do not provide financial advice. Return only the email body.' },
        { role: 'user', content: draft.reply },
      ],
    }),
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

async function sendReply({ to, subject, text }) {
  if (process.env.EMAIL_AUTOREPLY_ENABLED !== 'true') return { sent: false, reason: 'EMAIL_AUTOREPLY_ENABLED is not true' };
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when email auto-replies are enabled');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Dispatch Pro <hello@dispatchpro.ai>', to: [to], subject: `Re: ${subject}`, text }),
  });
  if (!response.ok) throw new Error(`email provider returned HTTP ${response.status}`);
  return { sent: true, provider: 'resend', id: (await response.json()).id || null };
}

module.exports = { buildCustomReply, improveReplyWithAI, verifyWebhookSignature, sendReply, MINIMUM_CUSTOM_USD };
module.exports = { buildCustomReply, buildMiaReply, improveReplyWithAI, verifyWebhookSignature, sendReply, MINIMUM_CUSTOM_USD };
