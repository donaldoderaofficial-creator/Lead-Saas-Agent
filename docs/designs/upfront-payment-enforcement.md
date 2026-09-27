# Up-front Payment Enforcement

Idea:                No service is rendered on credit; every package and report is paid in full before access.
Chosen option:       Tighten the single access policy + verify every payment path (option B below).
Riskiest assumption: Existing PayPal/crypto customers keep access only while a paid period is on record.
Prototype plan:      Unit-test the policy and each payment path with mocked providers.
Files touched:       subscription-policy.js, server.js, mpesa-client.js, test/payment.test.js
Config/env:          None new.
Rollback:            Revert the commit; no schema change.
Done when:           All credit exposures below are closed and `npm test` passes.

## Credit exposures found

| # | Exposure | Fix |
|---|----------|-----|
| 1 | `trialing` and `approved` statuses granted access | Only `active` grants access |
| 2 | `currentPeriodEnd` ignored; crypto subscriptions set it to `null` = unlimited access from one monthly payment | Access requires a paid-through date in the future; crypto approval pays one month |
| 3 | PayPal `BILLING.SUBSCRIPTION.ACTIVATED` set `active` before any charge | Active only with `last_payment` or a recorded sale; otherwise `pending_payment` |
| 4 | PayPal renewals never extended; failed payments and expiry ignored | `PAYMENT.SALE.COMPLETED` extends one month (anchored to sale time); `PAYMENT.FAILED` -> `past_due`, `EXPIRED` -> `expired` |
| 5 | M-Pesa STK callback is unauthenticated; a forged `ResultCode: 0` released a report | Callback confirmed with Safaricom STK Push Query before release |
| 6 | M-Pesa C2B accepted any amount > 0 | Validation rejects unknown refs and short amounts before charging; confirmation withholds report and records `underpaid` |

## Options considered

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit |
|--------|-------|----------------|--------------|---------------|-----|
| A. Remove trial statuses only | 2 | 5 | 3 | 5 | 5 |
| B. Policy + verify each payment path | 5 | 3 | 4 | 5 | 5 |
| C. Full ledger/invoice service with per-tenant balances | 5 | 1 | 2 | 2 | 2 |

## Assumptions

- Billing is monthly for all plans (matches PayPal plan setup and pricing copy).
- Crypto early renewal extends from the current paid-through date.
- Cancelling a PayPal subscription ends access immediately (unchanged; not credit).

## Outcome

- 57/57 tests pass, including new tests for trials, lapsed periods, duplicate PayPal events, forged STK callbacks, and C2B underpayment.

## Follow-ups

- **Deploy impact:** an existing crypto subscription stored with `currentPeriodEnd = null` loses access until the next approved payment. Re-approve a fresh payment or set a paid-through date manually for customers who paid recently.
- `setup-paypal-subscriptions.js` imports `createProduct`/`createMonthlyPlan`, which `paypal-client.js` does not export. When restored, create plans with no trial cycle, `setup_fee_failure_action: CANCEL`, and `payment_failure_threshold: 1`.
- Crypto lead checkout in `/api/lead` quotes the USD price as the crypto amount; crypto lead payments have no admin approval path to release reports.
- Crypto subscription amount tolerance is +/-1%; consider rejecting any underpayment.
- Reconcile lost M-Pesa callbacks by querying STK status when `/leads/report/:ref` is polled.
