/**
 * Run this ONCE to set up your PayPal product + monthly billing plans.
 * Requires real PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in your .env
 * (sandbox is fine for testing).
 *
 * Usage: node deploy/setup-paypal-subscriptions.js
 *
 * Prints two Plan IDs at the end — copy them into your .env as:
 *   PAYPAL_PLAN_STARTER_MONTHLY=...
 *   PAYPAL_PLAN_GROWTH_MONTHLY=...
 */

require('dotenv').config();
const { createProduct, createMonthlyPlan } = require('../paypal-client');

async function main() {
  console.log('Creating product...');
  const product = await createProduct({
    name: 'Lead Agent SaaS',
    description: 'Event-driven lead qualification and prospecting platform',
  });
  console.log(`Product created: ${product.id}`);

  console.log('Creating Starter plan ($79/mo)...');
  const starter = await createMonthlyPlan({
    productId: product.id,
    name: 'Starter',
    description: 'Lead pipeline, payments, and dashboard',
    priceUsd: '79.00',
  });
  console.log(`Starter plan created: ${starter.id}`);

  console.log('Creating Growth plan ($249/mo)...');
  const growth = await createMonthlyPlan({
    productId: product.id,
    name: 'Growth',
    description: 'Everything in Starter, plus company and contact prospecting',
    priceUsd: '249.00',
  });
  console.log(`Growth plan created: ${growth.id}`);

  console.log('\nAdd these to your .env:');
  console.log(`PAYPAL_PLAN_STARTER_MONTHLY=${starter.id}`);
  console.log(`PAYPAL_PLAN_GROWTH_MONTHLY=${growth.id}`);
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
