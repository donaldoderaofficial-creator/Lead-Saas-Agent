The# Security Policy

## Current Controls

- Passwords are hashed with bcrypt and account setup/login requires TOTP 2FA.
- Sessions use an SQLite-backed store and production cookies are `httpOnly`,
	`secure`, and `sameSite=lax`.
- Login attempts and authenticated service usage are rate-limited.
- HTTP security headers are provided by Helmet and request bodies are size-limited.
- Payment webhooks verify provider signatures where supported; wallet payments
	remain pending until an administrator reviews the transaction proof.
- CodeQL, dependency auditing, syntax checks, and the Node test suite run in CI.

## Production Requirements

Set a random `SESSION_SECRET` of at least 32 characters, configure explicit
`CORS_ORIGINS`, use HTTPS, provide wallet/provider credentials through a secret
manager, and keep `DB_PATH` and `SESSION_DB_PATH` on persistent storage. Expose
`/health` for liveness and `/ready` for database-aware readiness checks.

## Reporting a Vulnerability

Report security issues privately to the project maintainer rather than opening a
public issue. Include reproduction steps, affected endpoint or component, and
the potential impact. Do not include real credentials, wallet keys, or personal
data in a report.
Tell them where to go, how often they can expect to get an update on a
reported vulnerability, what to expect if the vulnerability is accepted or
declined, etc.
