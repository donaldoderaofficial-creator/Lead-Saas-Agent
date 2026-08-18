# Quick Start Guide - Dispatch Pro v2.0

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp env.example .env
# Edit .env with your credentials

# Run development server
npm run dev

# Run tests
npm test

# Production deployment
NODE_ENV=production npm start
```

---

## Configuration

### Environment Variables
All configuration is centralized in [config.js](config.js), controlled by `.env`:

```bash
# Core
NODE_ENV=production
PORT=3000
HOST=localhost

# Database
DB_PATH=./data.db

# Security
SESSION_SECRET=your-secret-here
BCRYPT_ROUNDS=12

# Logging
LOG_FILE=./logs/app.log
LOG_LEVEL=info

# Feature Flags
FEATURE_PROSPECTING=true
FEATURE_WEBHOOKS=true
FEATURE_COMPLIANCE=true
```

### Access Configuration in Code
```javascript
const { config, get, isFeatureEnabled } = require('./config');

// Get value from config
console.log(config.port);  // 3000

// Get nested value
const pricing = get('pricing.usd.starter.price');  // '9.99'

// Check if feature is enabled
if (isFeatureEnabled('prospecting')) {
  // Your code here
}
```

---

## Key Modules

### 1. Cache System (`cache.js`)
```javascript
const { cache, withCache } = require('./cache');

// Set value with TTL
cache.set('key', value, 300);  // 5 minute TTL

// Get value
const value = cache.get('key');

// Wrap expensive function
const cachedFn = withCache(expensiveFunction, 'cache_key', 300);
const result = await cachedFn();

// Monitor cache performance
console.log(cache.stats());
// { size: 256, hits: 1000, misses: 100, hitRate: '90.91%' }
```

### 2. Logging System (`logger.js`)
```javascript
const { logger } = require('./logger');

// Log at different levels
logger.debug('Debug info', { detail: 'value' });
logger.info('Operation completed');
logger.warn('Possible issue', { code: 'WARN_001' });
logger.error('Critical error', { error: err.message });

// Get metrics
console.log(logger.getMetrics());
// { requests: 1000, errors: 5, warnings: 20 }
```

### 3. Rate Limiting (`rate-limiter.js`)
```javascript
const { RateLimiter, checkQuota, TIERS } = require('./rate-limiter');

const limiter = new RateLimiter();

// Check if user is rate limited
if (limiter.isLimited(userId, limit, windowMs)) {
  res.status(429).json({ error: 'Rate limit exceeded' });
}

// Check subscription quota
const quota = checkQuota(user, 'leads');
if (!quota.allowed) {
  res.status(403).json({ error: 'Quota exceeded', quota });
}

// Get available tiers
console.log(TIERS.growth);
// { name: 'Growth', leads: 5000, apiCallsPerHour: 10000, ... }
```

### 4. Database Optimization (`db-optimizer.js`)
```javascript
const { QueryOptimizer, IndexAdvisor } = require('./db-optimizer');

const optimizer = new QueryOptimizer(db);

// Execute query with automatic batching
const result = await optimizer.query('SELECT * FROM users', []);

// Get optimization metrics
console.log(optimizer.getMetrics());
// { totalQueries: 1000, batchedQueries: 950, avgQueryTime: 12.5 }
```

---

## API Endpoints

### Authentication
- `POST /auth/register` - Create account
- `POST /auth/login` - Log in
- `POST /auth/logout` - Log out
- `GET /auth/me` - Get current user

### Leads
- `POST /api/lead` - Submit new lead
- `GET /api/leads` - List leads
- `PATCH /api/leads/:ref/followup` - Update lead status
- `GET /leads/report/:ref` - Get lead report

### Admin
- `GET /health` - Health check
- `GET /metrics` - System metrics

See [API.md](API.md) for complete reference.

---

## Pricing Tiers

Configure in `config.js`:

```javascript
TIERS = {
  starter: { leads: 500, apiCallsPerHour: 1000, price: '$9.99' },
  growth: { leads: 5000, apiCallsPerHour: 10000, price: '$24.99' },
  scale: { leads: 'unlimited', apiCallsPerHour: 'unlimited', price: 'custom' }
}
```

Automatic enforcement via `rate-limiter.js`.

---

## Monitoring & Debugging

### Metrics Endpoint
```bash
curl http://localhost:3000/metrics
```

Response:
```json
{
  "logger": { "requests": 1234, "errors": 2, "warnings": 5 },
  "cache": { "size": 128, "hits": 1000, "hitRate": "88.5%" },
  "rateLimiter": 42
}
```

### Log Files
- Development: Console output (colored)
- Production: JSON logs to `./logs/app.log`

View logs:
```bash
tail -f logs/app.log | jq '.'  # Pretty-print JSON logs
```

### Health Check
```bash
curl http://localhost:3000/health
```

---

## Deployment

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t dispatch-pro .
docker run -e NODE_ENV=production -p 3000:3000 dispatch-pro
```

### Environment-Specific Deployment

**Development:**
```bash
NODE_ENV=development npm run dev
```

**Staging:**
```bash
NODE_ENV=staging npm start
```

**Production:**
```bash
NODE_ENV=production npm start
```

Each environment loads different configuration from `.env`.

---

## Troubleshooting

### High Memory Usage
Check cache size:
```javascript
console.log(cache.stats());  // size: X
```

Clear cache if needed:
```javascript
cache.clear();
```

### Slow Queries
Use IndexAdvisor:
```javascript
const advisor = new IndexAdvisor(db);
console.log(advisor.suggestIndexes());
```

### Rate Limit False Positives
Adjust limits in `config.js`:
```javascript
rateLimiting: {
  loginAttempts: 5,        // max attempts
  loginWindowMs: 300000,   // 5 minute window
  apiLimit: 1000,          // requests/hour
}
```

### Database Locking
Check active queries:
```javascript
const optimizer = new QueryOptimizer(db);
console.log(optimizer.getMetrics());
```

Enable WAL mode (already enabled):
```javascript
// In store.js: db.pragma('journal_mode = WAL');
```

---

## Performance Tips

### For Developers
1. Use caching for frequently accessed data
2. Batch database queries when possible
3. Log important events for debugging
4. Monitor rate limits to avoid customer complaints

### For Operations
1. Monitor `/metrics` endpoint regularly
2. Set up alerts for error rates > 1%
3. Review logs weekly for patterns
4. Scale database before hitting 100k leads

### For Business
1. Set appropriate pricing tiers
2. Monitor quota usage per tier
3. Recommend upgrades based on usage
4. Consider enterprise plans for power users

---

## Testing

```bash
# Run all tests
npm test

# Run with detailed output
npm test -- --test-reporter=spec

# Run specific test file
node --test test/compliance.test.js

# Check syntax only
npm run check
```

All tests should pass: `4/4 ✅`

---

## Support & Documentation

- **API Documentation:** [API.md](API.md)
- **Architecture Guide:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Deployment Guide:** [DEPLOY.md](DEPLOY.md) or [ORACLE_DEPLOY.md](ORACLE_DEPLOY.md)
- **Scalability Report:** [SCALABILITY_REPORT.md](SCALABILITY_REPORT.md)

---

## Feature Flags

Enable/disable features without redeploying:

```bash
FEATURE_PROSPECTING=false    # Disable prospecting
FEATURE_WEBHOOKS=false       # Disable webhooks
FEATURE_COMPLIANCE=false     # Disable compliance
FEATURE_2FA=false            # Disable 2FA
```

Access in code:
```javascript
if (isFeatureEnabled('prospecting')) {
  // Prospecting feature code
}
```

---

## Key Dates

- **Created:** August 18, 2026
- **Last Updated:** August 18, 2026
- **Version:** 2.0 (Production Ready)
- **Status:** All systems operational ✅

---

**Built by Odera Donald Ombok, BSc**  
**Founder & CEO, Dispatch Pro**  
**odera.ombok@dispatchpro.com**
