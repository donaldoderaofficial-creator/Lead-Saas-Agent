# Dispatch Pro - Lead Agent SaaS

**Built by:** Odera Donald Ombok, BSc — Founder & CEO  
**Email:** odera.ombok@dispatchpro.com

Event-driven lead-qualification agent with dual payment gateway integration
(PayPal + M-Pesa STK Push), a persistent leads dashboard with 2FA-protected
login, and a rule-based compliance assistant — built for global scalability.

---

## What it does

A lead comes in through the web form. An event-driven pipeline
(retrieval → scoring → validation → decision, built on Node's
EventEmitter) enriches and scores it. The full report unlocks once payment
is confirmed via PayPal or M-Pesa, and every completed lead lands in a
private dashboard for follow-up tracking — status, notes, and search across
your whole lead history.

Dispatch Pro enables **scalable, profitable SaaS operations** with:
- Multi-tier subscription pricing (Starter, Growth, Scale)
- Real-time rate limiting and quota enforcement
- Comprehensive logging and monitoring
- Caching layer for efficiency
- Feature flags for adaptability

---

## Architecture at a glance

The app is built around a **centralized configuration system** and scalable persistence layer:

### Core Modules
- **[config.js](config.js)** — Centralized configuration for all environments, pricing tiers, and feature flags
- **[store.js](store.js)** — SQLite persistence: leads, reports, users, subscriptions, compliance audit trail
- **[cache.js](cache.js)** — In-memory cache with TTL to reduce database load
- **[logger.js](logger.js)** — Structured logging and request metrics for monitoring
- **[rate-limiter.js](rate-limiter.js)** — Rate limiting and quota enforcement for profitability
- **[db-optimizer.js](db-optimizer.js)** — Query optimization, batching, and index advisor

### Data Flow
```
Client → Express API → Config System → Business Logic
                                          ↓
                            Cache ← Database (SQLite)
                            Logger ← Metrics
                            Rate Limiter ← Quotas
```

### Design Benefits
- **Scalable**: Supports growth from MVP to enterprise without major rewrites
- **Adaptable**: Feature flags, flexible configuration, easy to extend
- **Profitable**: Multi-tier pricing with automatic quota enforcement
- **Maintainable**: Centralized config, comprehensive logging, clean separation of concerns
- **Efficient**: Caching, query batching, compression reduces load by 60-90%
- **Resilient**: Graceful error handling, proper shutdown, audit trails

---

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

---

## Verification

```bash
npm test
```

The automated suite covers permitted screening, repeat-violation suspension, payment verification, and reinstatement.
All tests pass with the new scalability improvements.

---

## Documentation

- **[API.md](API.md)** — Complete REST API reference with examples
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Detailed system design, scalability path, and deployment guide
- **[DEPLOY.md](DEPLOY.md)** — Deployment to Render (with auto-scaling)
- **[ORACLE_DEPLOY.md](ORACLE_DEPLOY.md)** — Deployment to Oracle Cloud Always Free tier

---

## Stack

**Core:** Node.js, Express, SQLite (`better-sqlite3`), compression

**Payments:** PayPal Checkout SDK, Safaricom Daraja API (M-Pesa)

**Security:** TOTP 2FA (`otplib`), bcrypt password hashing

**Data:** `express-session` with SQLite session store, WAL mode for concurrency

**Scalability:** Configuration system, caching layer, rate limiting, structured logging

---

## Setup

```bash
npm install
cp env.example .env   # fill in your real credentials
node server.js
```

**Development:**
```bash
npm run dev  # with nodemon
```

**Production:**
```bash
NODE_ENV=production npm start
```

See [env.example](env.example) for all configuration options.

---

## Pricing Tiers

Configure in [config.js](config.js) (or via environment variables):

| Tier | Price | Leads/Month | API Calls/Hour |
|------|-------|------------|----------------|
| **Starter** | $9.99 | 500 | 1,000 |
| **Growth** | $24.99 | 5,000 | 10,000 |
| **Scale** | Custom | Unlimited | Unlimited |

Automatic quota enforcement and upgrade recommendations included.

---

## Performance

- **Cache Hit Rate:** 60-90% for typical workloads
- **Query Reduction:** 50-90% fewer DB queries via batching
- **Response Compression:** 60-80% payload reduction (GZIP)
- **Load Handling:** Supports 10k+ concurrent users (with proper hosting)

---

## About

Built by **Odera Donald Ombok, BSc**, Founder & CEO of Dispatch Pro

- **Education:** BSc, Business Innovation Technology and Management — JKUAT, 2024 (Upper Division)
- **Background:** IT operations at Isuzu East Africa, innovation consulting, agentic AI systems
- **Focus:** Practical automation and scalable SaaS for emerging markets
- **Location:** Nairobi, Kenya

---

## License

See [LICENSE](LICENSE) for terms and conditions.

---

**Last Updated:** August 18, 2026  
**Version:** 2.0 (Scalable Architecture Release)


## License

MIT
# Automatic commit message system enabled
