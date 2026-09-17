'use strict';

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BTC_USD_RATE = 70000;
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

const fallbackRate = Number(process.env.BTC_USD_PRICE || DEFAULT_BTC_USD_RATE);
let btcUsdRate = Number.isFinite(fallbackRate) && fallbackRate > 0
  ? fallbackRate
  : DEFAULT_BTC_USD_RATE;
let lastUpdatedAt = null;
let refreshTimer = null;

function getBtcUsdRate() {
  return { rate: btcUsdRate, source: lastUpdatedAt ? 'coingecko' : 'fallback', updatedAt: lastUpdatedAt };
}

async function refreshBtcUsdRate() {
  try {
    const response = await fetch(COINGECKO_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`rate provider returned HTTP ${response.status}`);
    const payload = await response.json();
    const rate = Number(payload?.bitcoin?.usd);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('rate provider returned an invalid BTC/USD rate');
    btcUsdRate = rate;
    lastUpdatedAt = new Date().toISOString();
    return getBtcUsdRate();
  } catch (error) {
    return { ...getBtcUsdRate(), error: error.message };
  }
}

function startBtcUsdSync(intervalMs = Number(process.env.BTC_RATE_REFRESH_MS) || DEFAULT_REFRESH_INTERVAL_MS) {
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

module.exports = { getBtcUsdRate, refreshBtcUsdRate, startBtcUsdSync, stopBtcUsdSync };
