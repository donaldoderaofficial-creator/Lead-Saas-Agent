# Development Best Practices Guide

## Code Quality Standards

### 1. Input Validation

Always validate user input at the entry point of your function.

```javascript
// ✅ GOOD
function submitLead(req, res) {
  const { name, email } = req.body;
  
  if (!validateEmail(email)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: 'Valid email is required' 
    });
  }
  
  // Process validated input
}

// ❌ BAD
function submitLead(req, res) {
  const lead = req.body;
  processLead(lead); // No validation!
}
```

### 2. Error Handling

Always handle errors with appropriate HTTP status codes and user-safe messages.

```javascript
// ✅ GOOD
try {
  const result = await processLead(leadData);
  res.json(result);
} catch (error) {
  logger.error('Lead processing failed', { email: leadData.email, error: error.message });
  res.status(HTTP_STATUS.SERVER_ERROR).json({ 
    error: ERROR_MESSAGE.SERVER_ERROR 
  });
}

// ❌ BAD
const result = await processLead(leadData);
res.json(result); // No error handling!
```

### 3. Logging

Always log important operations and errors with context.

```javascript
// ✅ GOOD
logger.info('Lead processed', { 
  email: lead.email, 
  score: result.score, 
  path: result.path 
});

// ❌ BAD
console.log('Done'); // No context, non-structured
```

### 4. Constants vs Magic Numbers

Always use constants from `constants.js` instead of magic numbers.

```javascript
// ✅ GOOD
const { LEAD_SCORE, HTTP_STATUS } = require('./constants');

if (score >= LEAD_SCORE.HOT_THRESHOLD) {
  res.status(HTTP_STATUS.OK).json(result);
}

// ❌ BAD
if (score >= 70) {
  res.status(200).json(result);
}
```

### 5. Type Checking

Always check types for critical inputs.

```javascript
// ✅ GOOD
function safeDivide(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new Error('Arguments must be numbers');
  }
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

// ❌ BAD
function divide(a, b) {
  return a / b; // No type checking!
}
```

### 6. JSDoc Documentation

Always document public functions with JSDoc.

```javascript
// ✅ GOOD
/**
 * Process a lead through qualification pipeline.
 * @param {Object} lead - Raw lead data with name and email
 * @param {string} lead.name - Lead's name
 * @param {string} lead.email - Lead's email
 * @returns {Promise<Object>} Result with qualified lead and log
 * @throws {Error} If validation fails
 * @example
 * const result = await processLead({ name: 'John', email: 'john@example.com' });
 */
async function processLead(lead) {
  // ...
}

// ❌ BAD
async function processLead(lead) {
  // No documentation!
}
```

## Validation Patterns

### Lead Data Validation

```javascript
const { validateLeadData } = require('./validators');

const validation = validateLeadData(leadData);
if (!validation.valid) {
  return res.status(HTTP_STATUS.BAD_REQUEST).json({
    error: ERROR_MESSAGE.VALIDATION_ERROR,
    details: validation.errors
  });
}
```

### Email Validation

```javascript
const { validateEmail } = require('./validators');

const email = validateEmail(userInput);
if (!email) {
  return res.status(HTTP_STATUS.BAD_REQUEST).json({
    error: 'Invalid email address'
  });
}
```

### Password Validation

```javascript
const { validatePassword } = require('./validators');

const passwordCheck = validatePassword(password);
if (!passwordCheck.valid) {
  return res.status(HTTP_STATUS.BAD_REQUEST).json({
    error: 'Password does not meet requirements',
    details: passwordCheck.errors
  });
}
```

## Error Response Standards

Use standard error responses:

```javascript
// Bad Request
res.status(HTTP_STATUS.BAD_REQUEST).json({
  error: 'Invalid input provided',
  details: ['email is required', 'name must be non-empty']
});

// Unauthorized
res.status(HTTP_STATUS.UNAUTHORIZED).json({
  error: 'Authentication required'
});

// Forbidden
res.status(HTTP_STATUS.FORBIDDEN).json({
  error: 'Access denied'
});

// Not Found
res.status(HTTP_STATUS.NOT_FOUND).json({
  error: 'Resource not found'
});

// Rate Limited
res.status(HTTP_STATUS.RATE_LIMITED).json({
  error: 'Too many requests. Please try again later.'
});

// Server Error
res.status(HTTP_STATUS.SERVER_ERROR).json({
  error: 'An internal error occurred. Please try again later.'
});
```

## Caching Best Practices

### Using withCache Helper

```javascript
const { cache, withCache } = require('./cache');

// For async operations
async function getUser(userId) {
  return withCache(
    `user:${userId}`,
    async () => {
      return await database.getUser(userId);
    },
    300 // 5 minutes
  );
}

// Manual cache management
cache.set('key', value, 300); // 5 minutes TTL
const cached = cache.get('key');
```

## Rate Limiting Usage

```javascript
const { RateLimiter } = require('./rate-limiter');

const limiter = new RateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 100 requests per hour
  message: { error: 'Too many requests' }
});

app.use(limiter.middleware());
```

## Middleware Best Practices

### Async Error Handling

```javascript
// ✅ GOOD: Use asyncHandler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.post('/api/lead', asyncHandler(async (req, res) => {
  const result = await processLead(req.body);
  res.json(result);
}));

// ❌ BAD: Unhandled promise rejection
app.post('/api/lead', async (req, res) => {
  const result = await processLead(req.body); // No catch!
  res.json(result);
});
```

## Testing Patterns

### Unit Test Template

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEmail } = require('../validators');

test('validateEmail() accepts valid emails', () => {
  const valid = validateEmail('user@example.com');
  assert.ok(valid);
});

test('validateEmail() rejects invalid emails', () => {
  const invalid = validateEmail('not-an-email');
  assert.equal(invalid, null);
});
```

### Integration Test Template

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

test('POST /api/lead with valid data', async () => {
  const response = await fetch('http://localhost:8000/api/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'John Doe',
      email: 'john@example.com'
    })
  });
  
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.status);
});
```

## Security Checklist

- [ ] All user inputs validated
- [ ] Sensitive data not logged
- [ ] Proper HTTP status codes used
- [ ] Error messages don't leak sensitive info
- [ ] Rate limiting implemented
- [ ] CSRF protection considered
- [ ] XSS prevention with sanitization
- [ ] SQL injection prevention (use prepared statements)
- [ ] Authentication checked on protected routes
- [ ] Authorization checked for admin routes

## Performance Checklist

- [ ] Database queries indexed properly
- [ ] Caching used for expensive operations
- [ ] Rate limiting prevents abuse
- [ ] Response compression enabled
- [ ] Large payloads handled with pagination
- [ ] Batch operations used where applicable
- [ ] Connection pooling configured
- [ ] Error handling doesn't cause cascading failures

## Debugging Tips

### Using Logger

```javascript
const { logger } = require('./logger');

// Different log levels
logger.debug('Debug info', { context: 'value' });
logger.info('Information', { context: 'value' });
logger.warn('Warning', { context: 'value' });
logger.error('Error', { context: 'value' });
```

### Checking Cache Status

```javascript
const { cache } = require('./cache');

const stats = cache.stats();
console.log(`Cache hit rate: ${stats.hitRate}`);
console.log(`Items cached: ${stats.size}`);
```

### Rate Limiter Debugging

```javascript
const remaining = limiter.getRemaining(userId, limit, window);
console.log(`Remaining requests: ${remaining}`);
```

## Common Pitfalls to Avoid

1. **No input validation** - Always validate!
2. **Exposing sensitive data in errors** - Use ERROR_MESSAGE constants
3. **Not logging errors** - Always log with context
4. **Magic numbers everywhere** - Use constants
5. **Unhandled promise rejections** - Use try-catch or .catch()
6. **No rate limiting** - Protect your API
7. **Missing JSDoc** - Document your functions
8. **Type coercion surprises** - Check types explicitly
9. **Caching without TTL** - Always set expiration
10. **Not testing edge cases** - Test error conditions

## Resources

- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [OWASP Security Guidelines](https://owasp.org/www-project-nodejs-security/)
