const COMMISSION_RATE = 0.2;
const COMMISSION_TERM_MONTHS = 12;
const CRYPTO_CURRENCIES = new Set(['BTC', 'ETH']);

function calculateCommission(amount, currency, rate = COMMISSION_RATE) {
  const value = Number(amount);
  const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!Number.isFinite(value) || value <= 0) throw new Error('amount must be a positive finite number');
  if (!/^[A-Z]{3,5}$/.test(normalizedCurrency)) throw new Error('currency must be a valid currency code');
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) throw new Error('rate must be greater than 0 and no greater than 1');
  const precision = CRYPTO_CURRENCIES.has(normalizedCurrency) ? 8 : 2;
  const multiplier = 10 ** precision;
  return Math.round((value * rate + Number.EPSILON) * multiplier) / multiplier;
}

function addCommissionTerm(startedAt) {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) throw new Error('startedAt must be a valid date');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + COMMISSION_TERM_MONTHS);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

function isWithinCommissionTerm(paymentAt, eligibleUntil) {
  const paymentTime = Date.parse(paymentAt);
  const expiryTime = Date.parse(eligibleUntil);
  if (!Number.isFinite(paymentTime) || !Number.isFinite(expiryTime)) {
    throw new Error('paymentAt and eligibleUntil must be valid dates');
  }
  return paymentTime <= expiryTime;
}

module.exports = {
  COMMISSION_RATE,
  COMMISSION_TERM_MONTHS,
  addCommissionTerm,
  calculateCommission,
  isWithinCommissionTerm,
};
