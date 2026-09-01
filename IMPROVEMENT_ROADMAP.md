# Dispatch Pro Improvement Roadmap

This roadmap converts the current recommendations into an execution plan for stabilizing, scaling, and operationalizing the product.

## Goal

Move the project from a feature-rich MVP into a production-ready SaaS system with cleaner architecture, stronger security, better reliability, and more predictable operations.

## Priority principles

- Keep business logic out of HTTP handlers.
- Standardize validation and error responses.
- Treat payments and webhooks as critical trust boundaries.
- Make every production change observable and reversible.
- Prefer migration-safe schema evolution over ad hoc table edits.

---

## Phase 1: Stabilize the API surface (Weeks 1-2)

### Objectives

- Reduce route complexity in [server.js](server.js)
- Standardize request validation and response contracts
- Improve reliability of core endpoints

### Work items

1. Split API route groups by domain
   - auth routes
   - lead/payment routes
   - dashboard routes
   - compliance/admin routes
   - prospecting routes

2. Create service layer modules
   - auth service
   - payment service
   - lead processing service
   - subscription service

3. Add centralized validation
   - request schema checks for all public routes
   - consistent `400`, `401`, `402`, `403`, `404`, `429`, `500` handling
   - sanitized provider error messages for clients

4. Add structured error envelope
   - `code`
   - `message`
   - `details` optional

### Definition of done

- Public routes are thin wrappers around service calls.
- Validation is centralized and reusable.
- Error responses are predictable across the API.

---

## Phase 2: Harden security and trust boundaries (Weeks 2-4)

### Objectives

- Protect session handling and sensitive endpoints
- Improve security posture for admin and payment flows
- Reduce exposure to bad webhook and auth patterns

### Work items

1. Add security middleware
   - Helmet
   - CSRF protection for cookie-based session flows
   - stricter CORS and origin checks
   - request rate limiting by route and user type

2. Strengthen session management
   - idle timeout and absolute timeout
   - secure rotation policies
   - session invalidation on privilege changes

3. Validate providers more strictly
   - PayPal webhook signature verification remains mandatory
   - M-Pesa callback validation and idempotency checks
   - reject duplicate payment confirmations

4. Improve admin access controls
   - explicit role checks for compliance and billing operations
   - audit log per privileged action
   - permissions matrix for owner/admin user roles

### Definition of done

- Security headers are enforced in production.
- No unverified payment callback is trusted.
- Privileged actions are logged and traceable.

---

## Phase 3: Improve persistence and data safety (Weeks 3-5)

### Objectives

- Make database changes safe and repeatable
- Improve read/write performance
- Reduce risk when schema evolves

### Work items

1. Introduce migration system for [store.js](store.js)
   - versioned schema migrations
   - migration checks on startup
   - safe rollback plan documentation

2. Add database indexes and query tuning
   - leads by user, status, and payment reference
   - compliance incidents by client and status
   - subscriptions and audit tables by time and owner

3. Add transactional write patterns
   - payment confirmation
   - report generation
   - compliance review updates

4. Add backup and restore verification
   - daily backups
   - restore drill checks
   - validation of critical data integrity

### Definition of done

- Schema changes are versioned and reproducible.
- Core queries are indexed and monitored.
- Critical write flows are atomic and auditable.

---

## Phase 4: Increase observability and operational confidence (Weeks 4-6)

### Objectives

- Make issues diagnosable quickly
- Improve release safety and production monitoring
- Reduce incident response time

### Work items

1. Add request correlation IDs
   - attach across logs and downstream services
   - expose request trace IDs in API responses for debugging

2. Expand logger metrics
   - endpoint latency distribution
   - error rate by route
   - payment provider success and failure rates
   - cache hit rate

3. Add dependency health checks
   - DB health
   - external provider connectivity
   - session store status
   - cache health

4. Create alerting rules
   - high webhook verification failures
   - unexpected payment spikes or drops
   - excessive rate-limit events
   - DB write failures or retries

### Definition of done

- A production incident can be traced from request to data store.
- Core dependency health is measured continuously.
- Alert thresholds are documented and reviewed.

---

## Phase 5: Payment resiliency and revenue controls (Weeks 5-7)

### Objectives

- Make payment flows more reliable and idempotent
- Reduce revenue leakage and duplicate processing
- Improve subscription handling quality

### Work items

1. Add idempotency protection
   - payment reference deduplication
   - webhook replay handling
   - duplicate lead/report prevention

2. Improve provider orchestration
   - explicit state machine for payment lifecycle
   - timeouts and retries with safe backoff
   - status reconciliation job for pending transactions

3. Strengthen subscription logic
   - renewals, cancellations, and suspension checks
   - active plan verification before premium actions
   - subscription state export and review

### Definition of done

- Duplicate payment or lead processing is prevented.
- Pending payment states are reconciled automatically.
- Subscription status is consistent across app flows.

---

## Phase 6: Expand tests and release pipeline (Weeks 6-8)

### Objectives

- Reduce regressions
- Make releases dependable and reviewable
- Increase confidence for payment and auth changes

### Work items

1. Add integration tests for key flows
   - login and 2FA flow
   - lead submission and payment confirmation
   - webhook signature rejection/acceptance
   - rate limiting and lockouts
   - compliance decision flow

2. Add CI pipeline
   - install and test
   - syntax check
   - smoke tests
   - dependency audit

3. Add release checklist
   - credential validation
   - migration verification
   - production config review
   - rollback plan

### Definition of done

- Critical flows are covered by automated tests.
- Every release has a defined validation checklist.
- High-risk changes can be rolled back safely.

---

## Phase 7: Product hardening and user experience polish (Weeks 8-10)

### Objectives

- Improve operational UX for admins and customers
- Finalize production readiness
- Reduce support burden

### Work items

1. Improve dashboard usability
   - clearer lead states and statuses
   - filters and saved searches
   - export of leads and reports

2. Improve billing UX
   - upgrade/downgrade flows
   - clearer plan information
   - explicit subscription status visuals

3. Improve customer communication
   - payment status messaging
   - pending vs. completed report states
   - escalation or retry guidance

### Definition of done

- Core dashboard flows are clear and supportable.
- Customers understand payment and report state without confusion.
- Support overhead decreases as flows become self-explanatory.

---

## Success metrics

Track the following before declaring production maturity:

- 99.9% critical endpoint availability
- payment duplicate rate below 0.1%
- webhook verification failure rate under expected threshold
- median API response time below target for core routes
- 100% of production entries covered by audit logging
- 100% critical schemas under migration control

---

## Recommended execution order

1. Phase 1: API stabilization
2. Phase 2: Security hardening
3. Phase 3: Storage safety and migration
4. Phase 4: Observability
5. Phase 5: Payment resiliency
6. Phase 6: CI and testing
7. Phase 7: UX polish

This sequencing reduces risk early while improving the foundation needed for high-value feature work.
