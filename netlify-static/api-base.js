/**
 * Canonical API URL resolution for every Dispatch Pro frontend.
 *
 * Resolution order:
 *   1. window.DISPATCH_API_URL  (set in runtime-config.js, for frontends that
 *      are NOT hosted on the same site as the API, e.g. a manual drag-and-drop
 *      deploy or an external landing page).
 *   2. <meta name="dispatch-api-base" content="https://...">
 *   3. Same-origin relative paths. On Netlify these are served by the redirects
 *      in netlify.toml (Netlify Functions for the stateless payment/config
 *      API); locally they are served by the Express server.
 *
 * Stateless endpoints additionally fall back to their direct Netlify Function
 * path so the billing page still renders BTC/ETH addresses if a redirect rule
 * is missing or a proxied origin is unavailable.
 */
(function () {
  function metaBase() {
    const meta = document.querySelector('meta[name="dispatch-api-base"]');
    return meta ? String(meta.content || '').trim() : '';
  }

  const base = String(window.DISPATCH_API_URL || metaBase() || '').replace(/\/+$/, '');

  // Stateless endpoints served by Netlify Functions.
  const FUNCTION_FALLBACKS = {
    '/api/payments/options': '/.netlify/functions/payments-options',
    '/api/config': '/.netlify/functions/public-config',
  };

  function url(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async function apiFetch(path, options = {}) {
    const candidates = [url(path)];
    const fallback = FUNCTION_FALLBACKS[path];
    if (fallback) candidates.push(url(fallback));

    let lastError = null;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, options);
        if (response.ok) return response;
        lastError = new Error(`Request to ${candidate} failed with HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`Request to ${path} failed`);
  }

  /** Retry wrapper used for first-paint requests that must not fail silently. */
  async function apiFetchWithRetry(path, options = {}, attempts = 3, delayMs = 400) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await apiFetch(path, options);
      } catch (error) {
        lastError = error;
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  window.DispatchAPI = { base, url, fetch: apiFetch, fetchWithRetry: apiFetchWithRetry };
})();
