# Dispatch Pro - Architecture & Design

## Overview

Dispatch Pro is a **scalable, maintainable, and profitable SaaS platform** for lead qualification and management. This document describes the complete system architecture, design patterns, and best practices.

---

## Core Principles

1. **Scalability** - Handle growth without major rewrites
2. **Adaptability** - Flexible configuration and feature flags
3. **Profitability** - Multi-tier pricing with quota enforcement
4. **Maintainability** - Clean code, comprehensive logging, and documentation
5. **Efficiency** - Caching, batching, and query optimization
6. **Resilience** - Graceful error handling and graceful shutdown

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Client (Browser/Mobile)               │
└──────────────────────────┬──────────────────────────────┘
                           │
                   HTTP/HTTPS (REST API)
                           │
┌──────────────────────────▼──────────────────────────────┐
│                   Express.js Server                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Middleware Layer                                  │ │
│  │  - requestLogger (Monitoring)                      │ │
│  │  - compression (Efficiency)                        │ │
│  │  - errorHandler (Resilience)                       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Business Logic Layers                             │ │
│  │  - Authentication (auth.js)                        │ │
│  │  - Lead Processing (lead-pipeline.js)              │ │
│  │  - Compliance Checking (compliance.js)             │ │
│  │  - Payment Integration (paypal-client.js)          │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Infrastructure Layers                             │ │
│  │  - Cache Layer (cache.js)                          │ │
│  │  - Rate Limiter (rate-limiter.js)                  │ │
│  │  - Logger (logger.js)                              │ │
│  │  - Config System (config.js)                       │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────┘
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
    ▼                      ▼                      ▼
┌─────────┐           ┌─────────┐           ┌──────────┐
│ SQLite  │           │ PayPal  │           │  M-Pesa  │
│ (Store) │           │  API    │           │   API    │
└─────────┘           └─────────┘           └──────────┘
```

---

## Module Breakdown

### 1. **Configuration System** (`config.js`)
- **Purpose**: Centralized configuration for all environments
- **Features**:
  - Environment-specific settings (dev/prod/test)
  - Feature flags for optional functionality
  - Pricing tier definitions
  - Security and rate-limiting settings
  - Performance optimization options
- **Scalability**: Enables easy multi-environment deployment

### 2. **Caching Layer** (`cache.js`)
- **Purpose**: In-memory cache with TTL support
- **Features**:
  - Reduces database queries
  - Configurable TTL per entry
  - Cache statistics and monitoring
  - Automatic expiration
- **Efficiency**: Improves response times by 10-100x for cached data

### 3. **Logger & Monitoring** (`logger.js`)
- **Purpose**: Structured logging and request metrics
- **Features**:
  - Structured JSON logging for production
  - Multiple log levels (debug, info, warn, error)
  - Request/response metrics collection
  - Automatic error tracking
- **Maintainability**: Critical for debugging and observability

### 4. **Rate Limiting & Quotas** (`rate-limiter.js`)
- **Purpose**: Fair resource allocation and profitability
- **Features**:
  - Per-user rate limiting with configurable windows
  - Multi-tier subscription quotas
  - Quota tracking and enforcement
  - Upgrade recommendations
- **Profitability**: Enables scalable pricing model

### 5. **Database Optimization** (`db-optimizer.js`)
- **Purpose**: Query optimization and performance tuning
- **Features**:
  - Query batching to reduce round trips
  - Connection pooling simulator
  - Index advisor with recommendations
  - Query performance metrics
- **Scalability**: Supports efficient multi-user access

### 6. **Authentication** (`auth.js`)
- **Purpose**: Secure user authentication and 2FA
- **Features**:
  - bcrypt password hashing
  - TOTP-based 2FA (RFC 6238)
  - QR code generation
  - Flexible role management
- **Security**: Industry-standard practices

### 7. **Lead Processing** (`lead-pipeline.js`)
- **Purpose**: Core business logic for lead qualification
- **Features**:
  - Lead enrichment from external APIs
  - Scoring and qualification logic
  - Recommendation generation
  - Async event-driven architecture
- **Adaptability**: Event emitter enables extension

### 8. **Compliance & Risk** (`compliance.js`)
- **Purpose**: Risk screening and compliance enforcement
- **Features**:
  - Rule-based compliance checking
  - Client suspension for repeated violations
  - Audit trail recording
  - Flexible rule definitions
- **Maintainability**: Centralized compliance logic

### 9. **Data Persistence** (`store.js`)
- **Purpose**: SQLite-backed data storage
- **Features**:
  - Lead and report management
  - User accounts with roles
  - Subscription tracking
  - Audit logs
  - Transaction support (WAL mode)
- **Scalability**: SQLite is suitable for MVP; migration path to PostgreSQL exists

### 10. **Payment Integration**
- **PayPal** (`paypal-client.js`): Checkout and subscription flows
- **M-Pesa** (`mpesa-client.js`): Mobile money payments
- **Flexibility**: Easy to add more payment providers

---

## API Design

### RESTful Endpoints
- **Authentication**: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`
- **Leads**: `/api/leads`, `/api/leads/:ref/followup`
- **Reports**: `/leads/report/:ref`
- **Prospecting**: `/api/prospecting/companies`, `/api/prospecting/person`
- **Health**: `/health`, `/metrics`

### Request/Response Format
```json
{
  "status": "ok",
  "data": {},
  "error": null
}
```

### Rate Limit Headers
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1692123456
```

---

## Data Model

### Users Table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  totp_secret TEXT,
  totp_enabled BOOLEAN DEFAULT 0,
  tier TEXT DEFAULT 'starter',
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Leads Table
```sql
CREATE TABLE pending_leads (
  ref TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  payment_method TEXT,
  created_at TIMESTAMP
);
```

### Subscriptions Table
```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tier TEXT DEFAULT 'starter',
  status TEXT DEFAULT 'active',
  billing_cycle TEXT DEFAULT 'monthly',
  next_renewal DATE,
  created_at TIMESTAMP
);
```

---

## Performance Optimization

### Caching Strategy
- **Session data**: 5 minutes TTL
- **User profiles**: 10 minutes TTL
- **Company data**: 1 hour TTL
- **Reports**: Cache until expiration (no TTL)

### Query Batching
- Batch up to 50 queries per 50ms window
- Reduces database round trips by 50-90%
- Configurable via `config.performance.enableBatching`

### Compression
- GZIP compression enabled for all responses
- Reduces payload size by 60-80%

### Connection Pooling
- SQLite single-threaded model
- Migration path to PostgreSQL with native pooling

---

## Security

### Authentication
- TOTP-based 2FA for all users
- bcrypt with 12 rounds for password hashing
- Session timeout: 8 hours
- Brute-force protection: 5 attempts per 5 minutes

### Authorization
- Role-based access control (RBAC)
- Subscription tier enforcement
- Feature flag gates

### Data Protection
- HTTPS-only in production
- HttpOnly and Secure cookies
- CSRF protection enabled
- SQL injection prevention via prepared statements

---

## Scalability Path

### Phase 1: Current (MVP)
- SQLite database
- Single-process Node.js
- In-memory caching
- Suitable for: < 10k users, < 1M leads/month

### Phase 2: Growth (10k - 100k users)
- PostgreSQL database
- Horizontal scaling with load balancer
- Redis caching layer
- Message queue (RabbitMQ/SQS)
- Microservices for lead processing

### Phase 3: Enterprise (100k+ users)
- Distributed database (sharding)
- Kubernetes orchestration
- Global CDN
- Real-time analytics pipeline
- Multi-region deployment

---

## Monitoring & Alerts

### Key Metrics
- Request latency (p50, p95, p99)
- Error rate
- Cache hit rate
- Database query time
- Rate limit violations

### Logging
- Structured JSON logs to file
- Integration with ELK/DataDog in production
- Real-time error tracking via Sentry

### Health Checks
- `/health` endpoint for load balancer
- `/metrics` endpoint for monitoring dashboards

---

## Deployment

### Development
```bash
npm install
npm run dev  # with nodemon
```

### Production
```bash
npm ci
NODE_ENV=production npm start
```

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "server.js"]
```

### Environment Variables
See `env.example` for all available configuration options.

---

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
- PayPal/M-Pesa payment flows
- Lead qualification pipeline
- Compliance rule enforcement

### Load Testing
```bash
npm run load-test  # with autocannon
```

---

## Future Enhancements

1. **Real-time Notifications**: WebSocket support for live updates
2. **API Webhooks**: Custom integrations for customers
3. **Analytics Dashboard**: Business intelligence and reporting
4. **Mobile App**: Native iOS/Android support
5. **Marketplace**: Third-party integrations and plugins
6. **White-labeling**: Brand customization for enterprise customers
7. **International**: Multi-currency and multi-language support

---

## Maintenance

### Regular Tasks
- Database optimization: `ANALYZE` and `VACUUM` weekly
- Log rotation: Archive logs monthly
- Dependency updates: Monthly security checks
- Backup: Daily automated backups

### Monitoring Dashboard
- Real-time request metrics
- Error rate trends
- Cache performance
- Payment processing status

---

**Last Updated**: August 18, 2026  
**Version**: 1.0  
**Architecture Pattern**: Monolithic (scalable to microservices)
