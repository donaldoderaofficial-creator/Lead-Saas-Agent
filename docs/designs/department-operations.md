# Department Operations (HR, Marketing & Sales, Manufacturing, IT, Service)

Idea:                One work-tracking system for all departments, with SLAs, controlled lifecycles, an audit trail, and the up-front payment rule applied to billable work.
Chosen option:       B. Shared work-item engine with per-department types and rules.
Riskiest assumption: One lifecycle vocabulary fits every department (manufacturing needs an extra quality stage).
Prototype plan:      Pure rule module + store tests, then API handler tests.
Files touched:       operations.js, store.js, server.js, constants.js, public/operations.html, test/operations.test.js, package.json
Config/env:          None.
Rollback:            Revert the commit; the new `ops_items`/`ops_audit` tables are additive and unused by other code.
Done when:           Each department can log, track, and close work; overdue work and sales follow-ups are visible; billable jobs cannot start unpaid; `npm test` passes.

## Department mapping

| Department | Work types | Special rules |
|------------|-----------|---------------|
| HR | hiring, onboarding, offboarding, leave, performance_review, training | Admin-only (holds staff data) |
| Marketing & Sales | campaign, content, deal, follow_up | Existing lead follow-ups flagged overdue: `new` > 24h, `contacted` > 72h without update |
| Manufacturing | work_order, maintenance, quality_issue | `work_order` needs confirmed payment to start; all work must pass `quality_check` before `done` |
| IT | incident, change, access_request, asset | Priority SLA |
| Service | support_ticket, service_job, complaint | `service_job` needs confirmed payment to start |

Priority SLA: urgent 4h, high 24h, normal 72h, low 168h (overridable with `dueAt`).
Lifecycle: `open -> in_progress -> (blocked <-> in_progress) -> done`, `cancelled` from any open state.

## Options considered

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit |
|--------|-------|----------------|--------------|---------------|-----|
| A. Written process plan only | 2 | 5 | 5 | 5 | 3 |
| B. Shared work-item engine | 5 | 3 | 4 | 5 | 5 |
| C. Separate HR/MRP/ITSM/CRM modules | 5 | 1 | 2 | 2 | 2 |

## API (admin only)

- `GET /api/operations/departments`, `GET /api/operations/overview`
- `POST /api/operations/items`, `GET /api/operations/items?department=&status=`
- `PATCH /api/operations/items/:id/status` `{ status, paymentReference? }` -> 402 `payment_required` if billable and unpaid
- `GET /api/operations/items/:id/audit`
- UI: `/operations.html`

## Assumptions

- "Fix the departments" means both new modules and improvements to existing features (confirmed by user).
- Pain points: slow follow-up, slow support, deploy/IT issues, untracked work (user confirmed the examples).
- Operations are internal to the business owner, so owner/admin access only.
- A payment counts only when its status is `confirmed` (not `underpaid`, `pending_review`, or `rejected`).

## Outcome

- 64/64 tests pass (7 new).
- Fixed an existing bug: `HTTP_STATUS.PAYMENT_REQUIRED` was undefined, so every "subscription required" response had an invalid status code; now 402.

## Follow-ups

- No link to `/operations.html` from the dashboard yet (dashboard HTML is minified).
- Marketing conversion by referral source (data exists in `pending_leads.referral_source`).
- Notifications (email) when items breach SLA.
- HR records may contain personal data; add field-level classification before storing sensitive details.
