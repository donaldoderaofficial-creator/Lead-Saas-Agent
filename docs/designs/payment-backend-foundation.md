# Payment Backend Foundation

## Problem frame

- **User & job:** The SaaS maintainer needs to evolve payment, lead, and admin APIs without increasing risk in a large `server.js`.
- **Problem:** HTTP routes, readiness checks, and operational metrics are registered in the same file as payment and business flows; the SQLite schema is created during store initialization.
- **Success metric:** New route groups can be moved behind a testable router/service boundary while preserving response contracts and auth gates.
- **Constraints:** Keep CommonJS and Express, preserve current endpoint behavior, and avoid changing payment or persistence semantics in this first increment.
- **Non-goals:** A full server rewrite, PostgreSQL cutover, queue deployment, and payment/auth behavior changes are not part of this pilot.

## Options

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|---|---:|---:|---:|---|---:|
| Incrementally extract a low-risk route group with injected dependencies | 4 | 4 | 5 | High | 5 |
| Move all route groups and services in one refactor | 5 | 1 | 1 | Low | 3 |
| Replace persistence and add a queue before decomposing routes | 4 | 1 | 1 | Low | 2 |

## Design brief

**Idea:** Establish a safe, incremental route/service and operations foundation for the payment-heavy SaaS backend.

**Chosen option:** Incremental extraction, starting with health/readiness/deployment-smoke/metrics routes. This creates a real, testable pattern while keeping payment, auth, and database behavior untouched.

**Riskiest assumption:** These operational routes can be extracted without changing their middleware placement, response shape, or admin-only metrics boundary. The prototype is the integration test suite exercising the extracted router over HTTP and asserting the response and authorization contracts.

**Prototype plan:** Construct the observability service with test doubles, mount its router in a minimal Express app, and verify health, readiness failures, deployment checks, and protected metrics.

**Files touched:** `server.js`, `routes/observability.js`, `services/observability-service.js`, `test/observability.test.js`, `package.json`, and this design brief.

**Config/env:** No new variables. Existing `BUILD_SHA`, `RENDER_GIT_COMMIT`, `EXPLORIUM_API_KEY`, and `MPESA_CALLBACK_URL` remain consumed by the health/deployment checks.

**Rollback:** Revert the extraction commit or remount the original handlers in `server.js`; no schema or external state changes are involved.

**Done when:** The extracted endpoints retain their existing response contracts and access control, targeted tests pass, and the repository syntax/test checks pass.

## Assumptions

- This recommendation is a request to begin implementation, not only to document a target architecture.
- The safest useful first increment is a route/service extraction pilot rather than a simultaneous database, queue, payment, and auth rewrite.
- Existing readiness semantics and the `/metrics` authentication boundary are intentional and should remain unchanged.

## Outcome

Implemented the observability route/service extraction and HTTP-level contract tests. The pilot demonstrates dependency injection and route modularity without changing payment processing, auth logic, persistence, or runtime configuration.

Validation results: `npm test` passed all 84 tests, including syntax checks and the new HTTP-level endpoint contract tests. `git diff --check` passed.

## Follow-up sequence

1. Extract one business route group together with its service and contract tests.
2. Replace startup schema creation with ordered, versioned SQLite migrations before selecting a Postgres adapter strategy; preserve a documented backup/rollback path.
3. Add provider-event idempotency and transactional confirmation around payment state transitions, guarded by replay/duplicate tests.
4. Introduce a durable queue only for work that needs retries or survives process restarts, then propagate request/event correlation IDs and dependency health.

The Postgres dialect, production queue provider, and deployment-specific monitoring backend remain decisions for their respective implementation phases.
