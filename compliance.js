/**
 * Conservative, explainable pre-screening for lead-generation requests.
 *
 * This is an internal safety control: it blocks clearly high-risk requests,
 * preserves an audit trail, and requires an administrator to review repeated
 * violations. It does not make legal determinations or send external reports.
 */

const { compliance } = require('./store');

const RULES = [
  { category: 'child sexual exploitation', pattern: /\b(child sexual abuse material|csam|groom (?:a )?child|sexual(?:ize|ising|izing) (?:a )?(?:child|minor))\b/i },
  { category: 'violent crime', pattern: /\b(mass (?:shooting|violence)|murder(?:ing)?|assassin(?:ate|ation)|terror(?:ist|ism)|bomb threat)\b/i },
  { category: 'weapons', pattern: /\b(nerve gas|biological weapon|radiological weapon|nuclear weapon|cluster munitions)\b/i },
  { category: 'self-harm', pattern: /\b(encourage (?:suicide|self-harm)|promote (?:suicide|self-harm)|dangerous self-harm challenge)\b/i },
  { category: 'privacy and credentials', pattern: /\b(steal (?:passwords?|credentials?)|doxx|home address(?:es)? for|credit card (?:numbers?|details?)|bank account (?:numbers?|details?))\b/i },
  { category: 'cybercrime', pattern: /\b(hack(?:ing)? (?:into )?|malware campaign|credential stuffing|phishing campaign)\b/i },
  { category: 'financial crime', pattern: /\b(money laundering|investment scam|defraud|fraudulent leads?)\b/i },
  { category: 'hate or discrimination', pattern: /\b(target|exclude|avoid) .*\b(?:race|ethnicity|religion|nationality|gender identity|sexual orientation|disability|pregnan(?:t|cy))\b/i },
  { category: 'defamation', pattern: /\bspread (?:false|unverified) (?:claims?|rumors?) about\b/i },
  { category: 'intellectual property abuse', pattern: /\bcopy (?:their|a competitor'?s) (?:website|content|course) verbatim\b/i },
];

const preferredPenaltyPaymentMethods = [
  {
    method: 'mpesa',
    label: 'M-Pesa',
    recipient: process.env.COMPLIANCE_MPESA_NUMBER,
    instructions: 'Send to this number and retain the transaction reference for administrator verification.',
  },
  {
    method: 'bitcoin',
    label: 'Bitcoin',
    recipient: process.env.COMPLIANCE_BITCOIN_ADDRESS,
    instructions: 'Send only on the Bitcoin network and retain the transaction ID for administrator verification.',
  },
  {
    method: 'ethereum',
    label: 'Ethereum',
    recipient: process.env.COMPLIANCE_ETHEREUM_ADDRESS,
    instructions: 'Send only on the Ethereum network and retain the transaction hash for administrator verification.',
  },
].filter((method) => Boolean(method.recipient));

function clientKey(payload) {
  const value = payload.clientId || payload.email || 'anonymous';
  return String(value).trim().toLowerCase().slice(0, 254);
}

function screenableText(payload) {
  return ['campaign', 'description', 'message', 'notes', 'instructions', 'goal', 'targeting']
    .map((field) => typeof payload[field] === 'string' ? payload[field].trim() : '')
    .filter(Boolean)
    .join('\n');
}

function assess(payload) {
  const key = clientKey(payload);
  const client = compliance.getClient(key);
  if (client?.status === 'suspended') {
    return {
      allowed: false,
      clientKey: key,
      reason: 'Account is suspended pending administrator review.',
      violationCount: client.violation_count,
    };
  }

  const text = screenableText(payload);
  if (!text) return { allowed: true, clientKey: key };

  const categories = RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.category);
  if (!categories.length) return { allowed: true, clientKey: key };

  const incident = compliance.recordViolation(key, categories, text.slice(0, 500));
  return {
    allowed: false,
    clientKey: key,
    categories,
    incidentId: incident.incidentId,
    violationCount: incident.violationCount,
    reason: incident.status === 'suspended'
      ? 'Repeated policy violations suspended this account pending administrator review.'
      : 'This request was blocked for a safety-policy review.',
  };
}

module.exports = { assess, preferredPenaltyPaymentMethods };
