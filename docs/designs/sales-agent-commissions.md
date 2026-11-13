# Sales Agent Commissions

Idea:                Let Dispatch Pro sales agents earn on each directly closed BTC/ETH subscription sale.
Chosen option:       Authenticated sales-agent accounts, referral links, and a verified-payment commission ledger; this fits the existing login, SQLite, and webhook flows while keeping payouts manual.
Riskiest assumption: Crypto payment review reliably confirms the referred buyer's completed BTC or ETH subscription payment.
Prototype plan:      Exercise BTC/ETH commission arithmetic, per-sale referral attribution, payment approval, and duplicate submissions with isolated tests.
Files touched:       sales-commission.js, store.js, server.js, public/billing.html, netlify-static/billing.html, public/dashboard-v2.html, public/sales-agent.html, test/sales-agent.test.js, package.json, API.md, env.example
Config/env:          None.
Rollback:            Revert the feature code; commission and referral tables are additive and can remain unused.
Done when:           Active sales agents can register, share a link for a standard BTC/ETH subscription checkout, view per-sale crypto commissions, and duplicate or unverified payments never create earnings; `npm test` passes.

## Problem frame

- **User & job:** Dispatch Pro owner and sales agents who refer customers to paid packages.
- **Problem:** Existing referral tags record attribution but do not validate agents, accrue commissions, or show earnings.
- **Success metric:** Each directly referred, admin-verified BTC or ETH sale yields one auditable 20% commission entry, with no credit for fiat payments, later unattributed renewals, rejected/unverified payments, or duplicates.
- **Constraints:** Keep existing payment confirmation rules, use current SQLite and authenticated accounts, and support manually verified BTC/ETH subscription payments.
- **Non-goals:** Commissions on PayPal, M-Pesa, non-subscription products, custom-package quotes, or unverified payment proofs; automated money transfers.

## Options considered

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|--------|-------|----------------|--------------|---------------|-------------------|
| A. Keep referral tags and reconcile commissions manually | 2 | 5 | 4 | 5 | 4 |
| B. Agent accounts, referral links, verified-payment ledger, manual payout recording | 5 | 3 | 4 | 5 | 5 |
| C. Automated payout integration and full affiliate platform | 5 | 1 | 2 | 2 | 2 |

Option B is recommended: it gives agents a usable referral link and earnings view without introducing a new payout provider or changing subscription access.

## Assumptions

- Commission is **20%** of the directly referred BTC/ETH subscription sale amount. Future payments are eligible only if separately closed and referred by an agent.
- Earnings are recorded only in the payment's cryptocurrency (BTC or ETH); payout timing, exchange rates, and payout channel are agreed and handled manually.
- Existing Starter and Growth are the standard self-service packages. Custom-package proposals are not subscription checkout flows and are excluded.
- New accounts can opt into sales-agent registration; public registration cannot assign privileged administrative roles.
- Agent attribution is specific to each crypto checkout; only the referral code on that approved sale earns commission.

## Implementation outcome

- Kept and hardened the commission-policy prototype; commission amounts are restricted to BTC and ETH precision.
- Added agent self-registration, unique referral links, authenticated crypto-only earnings, approved-payment commissions, duplicate-submission handling, and admin-recorded manual payouts.
- Directly referred Starter/Growth BTC and ETH subscription checkouts accrue a commission after administrator approval. PayPal and M-Pesa sales do not earn commissions. Custom Scale quotes remain excluded because they do not have a package checkout/payment reference in the current product flow.
- Validation at initial implementation: `npm test` passed (89 tests), including the focused referral/payment tests and inline browser-script syntax checks.

## Follow-ups

- Legacy PayPal commission rows are excluded from earnings and payout routes.
- Reconcile refunds and chargebacks before recording manual payouts; automated reversal handling is not included.
- Confirm sales-agent terms, tax handling, payout schedule, and treatment of custom Scale quotes before launch.
- Roll back by reverting the feature code; additive commission tables can remain unused.
