const COMMISSION_RATE = 0.2;
const CRYPTO_CURRENCIES = new Set(['BTC', 'ETH']);

function calculateCommission(amount, currency, rate = COMMISSION_RATE) {
  const value = Number(amount);
  const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!Number.isFinite(value) || value <= 0) throw new Error('amount must be a positive finite number');
  if (!CRYPTO_CURRENCIES.has(normalizedCurrency)) throw new Error('currency must be BTC or ETH');
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) throw new Error('rate must be greater than 0 and no greater than 1');
  return Math.round((value * rate + Number.EPSILON) * 1e8) / 1e8;
}

module.exports = {
  COMMISSION_RATE,
  calculateCommission,
};
