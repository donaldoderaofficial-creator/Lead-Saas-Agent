'use strict';

/**
 * GET /.netlify/functions/public-config  (aliased to /api/config)
 *
 * Canonical, stateless public configuration endpoint: PayPal client id, plan
 * ids, pricing, and wallet availability. Contains no secrets.
 */

const { buildPublicConfig } = require('../../payment-catalog');
const { createReadOnlyHandler } = require('./_lib/respond');

const handler = createReadOnlyHandler(() => buildPublicConfig({ env: process.env }));

module.exports = { handler };
