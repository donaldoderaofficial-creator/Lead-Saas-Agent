'use strict';

/**
 * Canonical, dependency-free payment catalog.
 *
 * This module is the single source of truth for the public payment/config
 * payloads. It is shared by the local Express server (`server.js`) and by the
 * Netlify Functions in `netlify/functions/`, so both deployments always return
 * an identical contract.
 *
 * It must stay free of `dotenv`, `express`, and `./config` so that it can be
 * bundled into a stateless Netlify Function without requiring SESSION_SECRET
 * or a database.
 */

const { getBtcUsdRate, getCryptoUsdRate } = require('./crypto-rates');

// Documented production defaults. Override them in Netlify (and on any other
// host) with BITCOIN_WALLET_ADDRESS / ETHEREUM_WALLET_ADDRESS.
const DEFAULT_BITCOIN_WALLET_ADDRESS = '3EiZ7FZ5r8LB9rdKWmhei5MsErPj58dK3k';
const DEFAULT_ETHEREUM_WALLET_ADDRESS = '0xFFc40b1EcE21ce8A3b5e33caf95aA64bd8081330';

const DEFAULT_PRICING_USD = {
  starter: { price: '79.00', leads: 500 },
  growth: { price: '249.00', leads: 5000 },
  scale: { price: 'custom', leads: 'unlimited' },
};

const DEFAULT_EBOOK = {
  enabled: true,
  title: 'The Builder\'s Blueprint: From Zero to Profitable Product Engineer',
  subtitle: 'A practical guide to turning coding skills into income, systems, and leverage.',
  priceUsd: 9.99,
};

const SETTLEMENT_NOTE = 'Direct Bitcoin and Ethereum wallet transfers are accepted manually and require transaction confirmation before a report is released.';

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve wallet configuration from the environment, falling back to the
 * documented default addresses so BTC/ETH options are never unavailable.
 */
function resolveWallets(env = process.env) {
  return {
    bitcoin: {
      enabled: true,
      address: trimmed(env.BITCOIN_WALLET_ADDRESS) || DEFAULT_BITCOIN_WALLET_ADDRESS,
      currency: 'BTC',
      label: 'Bitcoin',
    },
    ethereum: {
      enabled: true,
      address: trimmed(env.ETHEREUM_WALLET_ADDRESS) || DEFAULT_ETHEREUM_WALLET_ADDRESS,
      currency: 'ETH',
      label: 'Ethereum',
    },
  };
}

/**
 * Build the `GET /api/payments/options` payload.
 */
function buildPaymentOptions({
  env = process.env,
  wallets = resolveWallets(env),
  paypalEnabled = true,
  mpesaEnabled = true,
} = {}) {
  const bitcoinEnabled = Boolean(wallets.bitcoin?.address);
  const ethereumEnabled = Boolean(wallets.ethereum?.address);
  const supportedCurrencies = [];
  if (paypalEnabled) supportedCurrencies.push('USD');
  if (mpesaEnabled) supportedCurrencies.push('KES');
  if (bitcoinEnabled) supportedCurrencies.push('BTC');
  if (ethereumEnabled) supportedCurrencies.push('ETH');

  return {
    providers: {
      paypal: {
        enabled: paypalEnabled,
        currency: 'USD',
        methods: paypalEnabled ? ['checkout'] : [],
      },
      mpesa: {
        enabled: mpesaEnabled,
        currency: 'KES',
        methods: mpesaEnabled ? ['stk-push'] : [],
      },
      bitcoin: {
        enabled: bitcoinEnabled,
        currency: 'BTC',
        methods: bitcoinEnabled ? ['wallet-transfer'] : [],
        address: wallets.bitcoin?.address,
        rate: getBtcUsdRate(),
      },
      ethereum: {
        enabled: ethereumEnabled,
        currency: 'ETH',
        methods: ethereumEnabled ? ['wallet-transfer'] : [],
        address: wallets.ethereum?.address,
        rate: getCryptoUsdRate('ethereum'),
      },
    },
    supportedCurrencies,
    settlement: SETTLEMENT_NOTE,
  };
}

/**
 * Build the `GET /api/config` payload consumed by the billing page.
 */
function buildPublicConfig({
  env = process.env,
  wallets = resolveWallets(env),
  pricingUsd = DEFAULT_PRICING_USD,
  ebook = DEFAULT_EBOOK,
  paypalEnabled = true,
  mpesaEnabled = true,
} = {}) {
  return {
    prospecting: {
      enabled: Boolean(env.EXPLORIUM_API_KEY),
      provider: 'Explorium',
    },
    paypalClientId: env.PAYPAL_CLIENT_ID || null,
    payments: {
      paypal: paypalEnabled,
      mpesa: mpesaEnabled,
      bitcoin: Boolean(wallets.bitcoin?.address),
      ethereum: Boolean(wallets.ethereum?.address),
    },
    plans: {
      starter: {
        paypalPlanId: env.PAYPAL_PLAN_STARTER_MONTHLY || null,
        priceMonthly: pricingUsd.starter.price,
        priceAnnual: (Number(pricingUsd.starter.price) * 10).toFixed(2),
      },
      growth: {
        paypalPlanId: env.PAYPAL_PLAN_GROWTH_MONTHLY || null,
        priceMonthly: pricingUsd.growth.price,
        priceAnnual: (Number(pricingUsd.growth.price) * 10).toFixed(2),
      },
    },
    ebook: {
      enabled: ebook?.enabled,
      title: ebook?.title,
      priceUsd: Number(ebook?.priceUsd || 19.99),
      walletAddress: ebook?.walletAddress || wallets.bitcoin?.address,
    },
  };
}

module.exports = {
  DEFAULT_BITCOIN_WALLET_ADDRESS,
  DEFAULT_ETHEREUM_WALLET_ADDRESS,
  DEFAULT_PRICING_USD,
  DEFAULT_EBOOK,
  SETTLEMENT_NOTE,
  resolveWallets,
  buildPaymentOptions,
  buildPublicConfig,
};
