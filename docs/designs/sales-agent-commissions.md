# Sales Agent Commissions

Idea:                Let Dispatch Pro sales agents earn on package subscriptions they refer.
Chosen option:       Authenticated sales-agent accounts, referral links, and a verified-payment commission ledger; this fits the existing login, SQLite, and webhook flows while keeping payouts manual.
Riskiest assumption: PayPal subscription webhooks include the merchant `custom_id` on activation so the agent attribution can be associated with later recurring charges.
Prototype plan:      Exercise commission arithmetic, 12-month eligibility, referral checkout attribution, and duplicate/out-of-order PayPal events with isolated tests.
Files touched:       sales-commission.js, store.js, server.js, public/billing.html, netlify-static/billing.html, public/dashboard-v2.html, public/sales-agent.html, test/sales-agent.test.js, package.json, API.md, env.example
Config/env:          None.
Rollback:            Revert the feature code; commission and referral tables are additive and can remain unused.
Done when:           Active sales agents can register, share a link for any standard plan, view their confirmed and pending commissions, and duplicate or unverified payments never create earnings; `npm test` passes.

## Problem frame

- **User & job:** Dispatch Pro owner and sales agents who refer customers to paid packages.
- **Problem:** Existing referral tags record attribution but do not validate agents, accrue commissions, or show earnings.
- **Success metric:** Every eligible, verified payment for a referred subscription yields one auditable 20% commission entry, with no credit for rejected/unverified payments.
- **Constraints:** Keep existing payment confirmation rules, use current SQLite and authenticated accounts, support PayPal recurring subscriptions and manually verified crypto package payments.
- **Non-goals:** Automated money transfers, commissions on non-subscription products, custom-package quotes, or commissions for unverified payment proofs.

## Options considered

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|--------|-------|----------------|--------------|---------------|-------------------|
| A. Keep referral tags and reconcile commissions manually | 2 | 5 | 4 | 5 | 4 |
| B. Agent accounts, referral links, verified-payment ledger, manual payout recording | 5 | 3 | 4 | 5 | 5 |
| C. Automated payout integration and full affiliate platform | 5 | 1 | 2 | 2 | 2 |

Option B is recommended: it gives agents a usable referral link and earnings view without introducing a new payout provider or changing subscription access.

## Assumptions

- Commission is **20%** of each successfully collected package payment for the first **12 months** after the customer's first verified referred payment. This is competitive for a recurring SaaS referral program while bounding acquisition cost.
- Earnings are recorded in the payment's currency (USD, BTC, or ETH); payout timing, exchange rates, and payout channel are agreed and handled manually.
- Existing Starter and Growth are the standard self-service packages. Custom-package proposals are not subscription checkout flows and are excluded.
- New accounts can opt into sales-agent registration; public registration cannot assign privileged administrative roles.
- Agent attribution is first-touch for a normalized customer email on crypto checkout and subscription-scoped for PayPal; provider-confirmed payments only.

## Implementation outcome

- Kept and hardened the commission-policy prototype; commission amounts use the source payment currency and fiat/crypto precision.
- Added agent self-registration, unique referral links, authenticated earnings, verified-payment commissions, duplicate/out-of-order webhook handling, and admin-recorded manual payouts.
- Standard Starter/Growth checkout paths accrue commissions. Custom Scale quotes remain excluded because they do not have a package checkout/payment reference in the current product flow.
- Validation: `npm test` passed (89 tests), including the focused referral/payment tests and inline browser-script syntax checks.

## Follow-ups

- Verify PayPal `custom_id` attribution end-to-end in a sandbox and ensure `PAYMENT.SALE.COMPLETED` is enabled on the deployed webhook.
- Reconcile refunds and chargebacks before recording manual payouts; automated reversal handling is not included.
- Confirm sales-agent terms, tax handling, payout schedule, and treatment of custom Scale quotes before launch.
- Roll back by reverting the feature code; additive commission tables can remain unused.
