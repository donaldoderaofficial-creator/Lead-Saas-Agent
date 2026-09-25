Upload this whole folder to Netlify as a static site.

Steps:
1. Open Netlify dashboard.
2. Click Add new site > Deploy manually.
3. Drag and drop this folder.
4. Netlify will publish the site and the homepage will load from index.html.

API configuration
-----------------
This folder is deployed as a SEPARATE Netlify site, so it cannot use
same-origin relative API paths. `runtime-config.js` sets
`window.DISPATCH_API_URL` to the canonical site that hosts the Netlify
Functions API (https://lead-saas-agent.netlify.app by default).

- Edit `runtime-config.js` if your canonical site uses a different domain.
- `api-base.js` is a copy of `public/api-base.js`; keep the two in sync.
- Wallet addresses are served by the canonical site's
  `/.netlify/functions/payments-options`, configured with
  `BITCOIN_WALLET_ADDRESS` and `ETHEREUM_WALLET_ADDRESS` in that site's
  environment variables. See DEPLOY.md section "2b".
- Crypto order/confirm calls are proxied by the canonical site to the stateful
  backend. Add this static site's origin to `CORS_ORIGINS` on that backend.

If you want the real billing backend, use the GitHub workflow already configured in .github/workflows/netlify.yml and add your Netlify site secrets.
