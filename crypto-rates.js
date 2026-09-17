'use strict';

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BTC_USD_RATE = 70000;
const DEFAULT_ETH_USD_RATE = 3500;
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd';

const fallbackBtcRate = Number(process.env.BTC_USD_PRICE || DEFAULT_BTC_USD_RATE);
const fallbackEthRate = Number(process.env.ETH_USD_PRICE || DEFAULT_ETH_USD_RATE);
let btcUsdRate = Number.isFinite(fallbackBtcRate) && fallbackBtcRate > 0
  ? fallbackBtcRate
  : DEFAULT_BTC_USD_RATE;
let ethUsdRate = Number.isFinite(fallbackEthRate) && fallbackEthRate > 0
  ? fallbackEthRate
  : DEFAULT_ETH_USD_RATE;
let lastUpdatedAt = null;
let refreshTimer = null;

function getBtcUsdRate() {
  return { rate: btcUsdRate, source: lastUpdatedAt ? 'coingecko' : 'fallback', updatedAt: lastUpdatedAt };
}

function getEthUsdRate() {
  return { rate: ethUsdRate, source: lastUpdatedAt ? 'coingecko' : 'fallback', updatedAt: lastUpdatedAt };
}

function getCryptoUsdRate(method) {
  return method === 'bitcoin' ? getBtcUsdRate() : getEthUsdRate();
}

async function refreshBtcUsdRate() {
  try {
    const response = await fetch(COINGECKO_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`rate provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const nextBtcRate = Number(payload?.bitcoin?.usd);
    const nextEthRate = Number(payload?.ethereum?.usd);
    if (!Number.isFinite(nextBtcRate) || nextBtcRate <= 0 || !Number.isFinite(nextEthRate) || nextEthRate <= 0) {
      throw new Error('rate provider returned an invalid crypto/USD rate');
    }
    btcUsdRate = nextBtcRate;
    ethUsdRate = nextEthRate;
    lastUpdatedAt = new Date().toISOString();
    return getBtcUsdRate();
  } catch (error) {
    return { ...getBtcUsdRate(), error: error.message };
  }
}

function startBtcUsdSync(intervalMs = Number(process.env.CRYPTO_RATE_REFRESH_MS || process.env.BTC_RATE_REFRESH_MS) || DEFAULT_REFRESH_INTERVAL_MS) {
  if (refreshTimer) return;
  refreshBtcUsdRate();
  refreshTimer = setInterval(refreshBtcUsdRate, intervalMs);
  refreshTimer.unref?.();
}

function stopBtcUsdSync() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

module.exports = { getBtcUsdRate, getEthUsdRate, getCryptoUsdRate, refreshBtcUsdRate, startBtcUsdSync, stopBtcUsdSync };
