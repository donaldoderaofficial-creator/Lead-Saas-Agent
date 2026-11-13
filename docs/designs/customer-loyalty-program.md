# Customer Loyalty Program

Idea:                Reward registered Dispatch Pro customers for verified subscription purchases.
Chosen option:       Add a SQLite points ledger, account balance/history endpoint, and fixed subscription-credit redemption; this gives customers a concrete benefit without cash payouts or subscription plan changes.
Riskiest assumption: A registered customer uses the same verified email for checkout, so the admin-approved purchase can be attributed to the correct account.
Prototype plan:      Test the USD-to-points calculation and credit conversion before integrating payment approval.
Files touched:       loyalty.js, store.js, server.js, public/dashboard-v2.html, public/billing.html, netlify-static/billing.html, test/loyalty.test.js, package.json, API.md
Config/env:          None.
Rollback:            Revert the feature code; the additive loyalty ledger can remain unused.
Done when:           Matching customer accounts earn points only after a unique BTC/ETH subscription payment is approved; customers can view points and redeem 100 points for $5 off a future subscription; duplicate approvals cannot mint points; `npm test` passes.

## Problem frame

- **User & job:** Dispatch Pro customers want a clear benefit for remaining subscribed.
- **Problem:** There is no customer-facing loyalty balance or reward.
- **Success metric:** Eligible customers see an auditable points balance, earn at most once per approved subscription payment, and can redeem points as subscription credit.
- **Constraints:** Keep customer rewards separate from sales-agent commissions; use verified account identity, admin-approved crypto payments, and reserve points atomically while a discounted order is pending.
- **Non-goals:** Cash-equivalent points, crypto payouts, agent commissions, automatic crypto rewards, or PayPal/M-Pesa transaction attribution in this first release.

## Options considered

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|--------|-------|----------------|--------------|---------------|-------------------|
| A. Points ledger with fixed subscription-credit redemption | 4 | 4 | 4 | 5 | 5 |
| B. Tiered subscription discounts across all providers | 5 | 2 | 2 | 3 | 3 |
| C. Cash or crypto rewards for purchases and referrals | 5 | 1 | 1 | 2 | 2 |

Option A is recommended: points are non-cash, the credit is modest, and new ledger rows are auditable and idempotent.

## Confirmed rules

- Customers earn **1 point for each complete $5** of the Starter or Growth subscription price actually paid, after an administrator approves a BTC or ETH payment.
- **100 points redeem for $5 in Lead SaaS subscription credit**. Points do not expire and have no cash value.
- Points used at checkout are reserved on order creation, consumed on approval, and released when an order is rejected or cancelled.
- The order email must match an authenticated registered customer account to redeem points; approved purchases are attributed to that same account.
- Points and sales-agent commissions are separate ledgers. The existing 20% BTC/ETH commission policy remains unchanged.
- Provider attribution for PayPal and M-Pesa is not included because the current subscription record does not reliably associate those recurring payments with a customer account.

## Assumptions

- Unused discounted orders can be cancelled by their customer to release reserved points; once payment proof has been submitted, only an administrator can reject the order and release the reservation.

## Implementation outcome

- Implemented an append-only SQLite ledger with idempotent payment awards and atomic point reservations, redemptions, and releases.
- Added authenticated balance/history, order cancellation, dashboard visibility, and subscription checkout credit controls.
- Validation: `npm test` passed, including syntax checks and all 95 tests.
- Follow-up risk: points are not automatically reversed for refunds or chargebacks; subscription payments require administrator review before points are awarded.
