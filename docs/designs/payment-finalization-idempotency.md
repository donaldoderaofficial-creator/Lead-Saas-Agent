# Payment finalization idempotency

## Problem framing

- **User and job:** A paying customer submits a lead and expects one report, even if a provider retries its callback.
- **Problem:** Concurrent callbacks can both observe an unfinished lead before either finishes processing it.
- **Success metric:** Concurrent callbacks for one payment reference invoke the lead pipeline once; a failed attempt remains retryable.
- **Constraints:** Keep this backend-only, preserve existing payment routes and response behavior, and use the current single-process SQLite deployment model.
- **Non-goals:** A queue, PostgreSQL migration, provider callback authentication redesign, and cross-instance locking.

## Options

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|---|---:|---:|---:|---|---:|
| In-process keyed single-flight guard | 4 | 5 | 4 | High | 5 |
| SQLite-backed finalization leases | 5 | 2 | 2 | Medium | 3 |
| Durable queue/outbox with worker claims | 5 | 1 | 3 | Medium | 2 |

**Chosen option:** In-process keyed single-flight guard. It closes the demonstrated concurrent retry race with no schema or deployment changes and matches the current single-process runtime. The payment record and completed report remain persisted as before.

**Riskiest assumption:** Payment callbacks are handled by one application process. If the service scales to multiple replicas, this guard is not a distributed lock and must be replaced by durable database claims or a queue.

## Design

- **Prototype:** Exercise same-key concurrent calls and verify different keys remain independent; verify a rejected operation can be retried.
- **Files touched:** `services/payment-finalization.js`, `server.js`, `test/payment-finalization.test.js`, and this brief.
- **Config/env:** None.
- **Rollback:** Revert the service, server wiring, test, and brief; no database or deployment changes are needed.
- **Done when:** Regression tests prove one operation per concurrent reference and a retry after failure, and the full test suite passes.

## Assumptions

- This change targets the current single-process Express/SQLite deployment and does not claim cross-instance idempotency.
- Existing provider verification and payment amount checks remain unchanged.

## Outcome

Implemented a per-reference single-flight wrapper around payment finalization. Concurrent retries share the same in-flight promise, while failures clear the key so provider retries can run again. No schema, UI, or environment configuration changed.

The regression tests and full `npm test` suite pass (100 tests). The whitespace check is clean.

## Next severe priorities

1. **High — authenticate M-Pesa C2B notifications.** The current confirmation handler validates the merchant shortcode and payment fields, but those values alone do not prove the request came from Safaricom. Select a provider-supported verification strategy before implementation.
2. **High — use durable cross-instance payment claims.** Replace the in-process guard before running multiple application replicas; the current SQLite deployment and this fix do not coordinate work across processes.
3. **High — introduce versioned schema migrations.** `store.js` currently applies schema changes at startup and suppresses `ALTER TABLE` errors, which can hide unexpected migration failures.
4. **Medium — move slow/retryable work to an outbox-backed worker.** This decouples provider acknowledgements from lead processing and permits bounded retries and operational visibility.
