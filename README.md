# Lead Agent SaaS

Event-driven lead-qualification agent with dual payment gateway integration
(PayPal + M-Pesa STK Push), a persistent leads dashboard with 2FA-protected
login, and a rule-based assistant — built for the Kenyan market.

## What it does

A lead comes in through the web form. An event-driven pipeline
(retrieval → scoring → validation → decision, built on Node's
EventEmitter) enriches and scores it. The full report unlocks once payment
is confirmed via PayPal or M-Pesa, and every completed lead lands in a
private dashboard for follow-up tracking — status, notes, and search across
your whole lead history.

## Architecture at a glance

The app is built around a small persistence layer in [store.js](store.js):

- pending leads stay in SQLite until payment confirmation arrives
- completed lead reports are stored as JSON documents and surfaced to the dashboard
- user accounts, roles, and TOTP configuration are kept as first-class records
- compliance incidents and audit activity are retained for review and reinstatement workflows
- session storage is initialized through the same SQLite-backed session factory used by Express

This keeps the system understandable and auditable without over-engineering the data model for a single-deployment SaaS setup.

## Safety and compliance controls

Lead submissions may include optional campaign, description, message, notes, instructions, goal, or targeting fields. Requests that clearly indicate high-risk activity are blocked before processing and recorded in an internal review queue.

- A first confirmed match creates a warning incident.
- A second match suspends that client identifier until an administrator reviews it.
- Authenticated administrators can inspect `GET /api/compliance/incidents`, mark an incident `cleared` or `confirmed`, and record a separately verified administrative-penalty payment with `POST /api/compliance/clients/:clientKey/verify-payment`.
- Reinstatement through `POST /api/compliance/clients/:clientKey/reinstate` is rejected until that verified payment record exists. Payment references are entered only by an administrator after independent confirmation.
- Preferred M-Pesa, Bitcoin, and Ethereum destinations are returned by `GET /api/compliance/payment-options`. The endpoint publishes collection details only; it does not validate transfers or automatically approve a receipt.
- Compliance review, payment verification, reinstatement, audit access, and legal-review recording are limited to `owner` and `admin` roles. Only the owner can create or promote an administrator.
- Every safety flag, review, payment verification, role change, and reinstatement is retained in the compliance audit log.
- No external-reporting endpoint exists. A human legal review must be recorded with `POST /api/compliance/incidents/:id/legal-review` before an administrator considers any external escalation.
- Payment destinations are read from `COMPLIANCE_MPESA_NUMBER`, `COMPLIANCE_BITCOIN_ADDRESS`, and `COMPLIANCE_ETHEREUM_ADDRESS`; they are not stored in source code.
- SQLite-backed sessions, schema migration tracking, and daily backups are enabled. Set `BACKUP_DIR` to persistent storage in production.

## Verification

```bash
npm test
```

The automated suite covers permitted screening, repeat-violation suspension, payment verification, and reinstatement.

## Stack

Node.js, Express, SQLite (`better-sqlite3`), PayPal Checkout SDK, Safaricom
Daraja API, `express-session` + TOTP 2FA (`otplib`) for dashboard auth.

## Setup

```bash
npm install
cp .env.example .env   # fill in your real credentials
node server.js
```

See `DEPLOY.md` for Render deployment, or `ORACLE_DEPLOY.md` for a free,
self-managed VM on Oracle Cloud's Always Free tier.

## About the developer

Built by **Donald Odera**, an Innovation Consultant and developer based in
Nairobi, Kenya.

- BSc, Business Innovation Technology and Management — Jomo Kenyatta
  University of Agriculture and Technology (JKUAT), 2024, Second Class
  Honours (Upper Division)
- IT department attachment at **Isuzu East Africa** — help desk support,
  hardware lifecycle management, and end-user computing across the
  organization
- Works across agentic AI systems, WordPress development, and innovation
  consulting, with a focus on practical automation for the East African
  market

## License

MIT
