'use strict';

/**
 * GET /.netlify/functions/payments-options  (aliased to /api/payments/options)
 *
 * Canonical, stateless payment options endpoint. Always returns the configured
 * BTC and ETH wallet addresses so the billing page can render them without a
 * stateful backend.
 */

const { buildPaymentOptions } = require('../../payment-catalog');
const { createReadOnlyHandler } = require('./_lib/respond');

const handler = createReadOnlyHandler(() => buildPaymentOptions({ env: process.env }));

module.exports = { handler };
