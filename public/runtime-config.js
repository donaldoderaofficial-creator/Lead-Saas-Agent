// Same-site deployment: leave DISPATCH_API_URL empty so the frontend uses
// relative paths, which Netlify resolves through netlify.toml (Netlify
// Functions for /api/payments/options and /api/config) and which the local
// Express server serves directly.
//
// Set this to an absolute origin ONLY for frontends hosted somewhere other
// than the canonical Netlify site.
window.DISPATCH_API_URL = '';
