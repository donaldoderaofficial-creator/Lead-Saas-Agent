# Dispatch Pro API Documentation

## Overview
Dispatch Pro is a scalable SaaS platform for lead qualification and management. This document describes all public API endpoints, authentication requirements, and response formats.

**Base URL:** `https://api.dispatchpro.com` (production) | `http://localhost:3000` (development)

**API Version:** 1.0

---

## Authentication

### Session-Based (Web Clients)
Uses HTTP cookies with express-session. Automatically managed by the browser.

### Token-Based (Future)
Will support JWT tokens for mobile/third-party integrations.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

---

## Rate Limiting

All endpoints are rate-limited per user subscription tier:

| Tier | API Calls/Hour | Leads/Month | Prospects/Month |
|------|---|---|---|
| Starter | 1,000 | 500 | 100 |
| Growth | 10,000 | 5,000 | 5,000 |
| Scale | Unlimited | Unlimited | Unlimited |

**Rate Limit Headers:**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1692123456
```

---

## Endpoints

### Authentication

#### `POST /auth/register`
Create a new user account (first-time registration).

**Request:**
```json
{
  "username": "alice",
  "password": "SecurePass123!"
}
```

**Response:** `200 OK`
```json
{
  "userId": "user_abc123",
  "username": "alice",
  "qrCodeDataUrl": "data:image/png;base64,...",
  "manualEntryKey": "JBSWY3DPEBLW64TMMQ======",
  "companyProfile": {
    "brand": "Dispatch Pro",
    "founder": "Odera Donald Ombok, BSc",
    "title": "Founder & CEO",
    "email": "odera@dispatchpro.com"
  }
}
```

---

#### `POST /auth/verify-setup`
Verify 2FA setup with authenticator code.

**Request:**
```json
{
  "username": "alice",
  "code": "123456"
}
```

**Response:** `200 OK`
```json
{
  "status": "verified"
}
```

---

#### `POST /auth/login`
Authenticate and establish session.

**Request:**
```json
{
  "username": "alice",
  "password": "SecurePass123!",
  "totpCode": "123456"
}
```

**Response:** `200 OK`
```json
{
  "status": "ok",
  "username": "alice",
  "companyProfile": {
    "brand": "Dispatch Pro",
    "founder": "Odera Donald Ombok, BSc",
    "title": "Founder & CEO",
    "email": "odera@dispatchpro.com"
  }
}
```

**Errors:**
- `401 Unauthorized` - Invalid credentials
- `403 Forbidden` - 2FA setup not completed
- `429 Too Many Requests` - Account locked (too many failed attempts)

---

#### `POST /auth/logout`
Destroy session and log out.

**Response:** `200 OK`
```json
{
  "status": "logged out"
}
```

---

#### `GET /auth/me`
Get current authenticated user info.

**Response:** `200 OK`
```json
{
  "username": "alice",
  "companyProfile": { /* ... */ },
  "founder": "Odera Donald Ombok, BSc",
  "founderTitle": "Founder & CEO"
}
```

**Errors:**
- `401 Unauthorized` - Not logged in

---

### Lead Management

#### `POST /api/lead`
Submit a new lead and initiate payment.

**Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "254712345678",
  "method": "paypal|mpesa"
}
```

**Response:** `200 OK`
```json
{
  "status": "created",
  "method": "paypal",
  "orderId": "3GD50328LB959043W",
  "approveUrl": "https://www.sandbox.paypal.com/..."
}
```

or (M-Pesa):
```json
{
  "status": "pending",
  "method": "mpesa",
  "checkoutRequestId": "ws_CO_12345678",
  "customerMessage": "Enter your M-Pesa PIN on your phone"
}
```

---

#### `GET /api/leads`
List all leads for the authenticated user. **Requires authentication.**

**Query Parameters:**
- `status` - Filter by status: `new`, `contacted`, `won`, `lost`
- `priority` - Filter by priority: `hot`, `nurture`
- `limit` - Max results (default: 100, max: 500)
- `offset` - Pagination offset (default: 0)

**Response:** `200 OK`
```json
{
  "leads": [
    {
      "ref": "lead_xyz789",
      "name": "John Doe",
      "email": "john@example.com",
      "company": "Example Corp",
      "score": 85,
      "path": "priority-outreach",
      "followupStatus": "new",
      "followupNotes": "",
      "createdAt": "2026-08-18T10:30:00Z"
    }
  ],
  "total": 42,
  "limit": 100,
  "offset": 0
}
```

**Errors:**
- `401 Unauthorized` - Not authenticated
- `429 Too Many Requests` - Rate limit exceeded

---

#### `PATCH /api/leads/:ref/followup`
Update follow-up status and notes for a lead. **Requires authentication.**

**Request:**
```json
{
  "status": "contacted|won|lost|new",
  "notes": "Called at 2pm, will follow up tomorrow"
}
```

**Response:** `200 OK`
```json
{
  "status": "saved"
}
```

**Errors:**
- `400 Bad Request` - Invalid status value
- `404 Not Found` - Lead not found
- `401 Unauthorized` - Not authenticated

---

### Reports & Analytics

#### `GET /leads/report/:ref`
Get the qualification report for a completed lead.

**Response:** `200 OK`
```json
{
  "ref": "lead_xyz789",
  "result": {
    "path": "priority-outreach",
    "score": 85,
    "reasoning": "Company size matches ICP, budget available, timeline urgent"
  },
  "premium": {
    "recommendedNextStep": "Call within 24 hours — enterprise-tier lead",
    "confidence": "high"
  }
}
```

---

### Prospecting (Premium Feature)

#### `POST /api/prospecting/companies`
Search for companies by criteria. **Requires authentication & Growth/Scale tier.**

**Request:**
```json
{
  "industry": "SaaS",
  "headcount_min": 50,
  "headcount_max": 500,
  "region": "North America"
}
```

**Response:** `200 OK`
```json
{
  "companies": [
    {
      "id": "comp_123",
      "name": "Example Corp",
      "industry": "SaaS",
      "headcount": 250,
      "revenue": "$10M-50M",
      "website": "https://example.com"
    }
  ]
}
```

---

#### `POST /api/prospecting/person`
Find contact information for a person. **Requires authentication & Growth/Scale tier.**

**Request:**
```json
{
  "fullName": "John Doe",
  "companyName": "Example Corp",
  "email": "john@example.com"
}
```

**Response:** `200 OK`
```json
{
  "name": "John Doe",
  "title": "VP Sales",
  "email": "john@example.com",
  "phone": "+1-555-123-4567",
  "company": "Example Corp",
  "linkedin": "https://linkedin.com/in/johndoe"
}
```

---

### Health & Status

#### `GET /health`
System health check.

**Response:** `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2026-08-18T10:30:00Z",
  "uptime": 86400
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "details": { /* optional additional context */ }
}
```

### Common Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_REQUEST` | 400 | Malformed request body |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Webhooks

Dispatch Pro can send real-time notifications to your system:

### Payment Completion
```json
{
  "event": "payment.completed",
  "ref": "lead_xyz789",
  "amount": 9.99,
  "currency": "USD",
  "method": "paypal",
  "timestamp": "2026-08-18T10:30:00Z"
}
```

### Lead Qualified
```json
{
  "event": "lead.qualified",
  "ref": "lead_xyz789",
  "score": 85,
  "path": "priority-outreach",
  "timestamp": "2026-08-18T10:30:01Z"
}
```

---

## Best Practices

### Pagination
Always use `limit` and `offset` for large result sets:
```
GET /api/leads?limit=50&offset=0
GET /api/leads?limit=50&offset=50
```

### Caching
Implement client-side caching for reports and company data (these don't change frequently).

### Error Handling
Always check HTTP status codes and handle 429 responses with exponential backoff.

### Rate Limit Monitoring
Check `X-RateLimit-Remaining` header to proactively avoid hitting limits.

---

## SDKs & Libraries

- **JavaScript/Node.js:** `npm install @dispatchpro/sdk`
- **Python:** `pip install dispatchpro`
- **Go:** `go get github.com/dispatchpro/go-sdk`
- **Ruby:** `gem install dispatchpro`

---

## Support

- **Email:** support@dispatchpro.com
- **Slack:** [Join our community](https://dispatchpro.slack.com)
- **Status Page:** https://status.dispatchpro.com

---

**Last Updated:** August 18, 2026  
**Version:** 1.0
