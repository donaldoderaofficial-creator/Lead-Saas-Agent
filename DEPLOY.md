# Deploying lead-agent-saas

## Before you deploy

This app writes to SQLite for pending leads and completed reports. Production
uses the Oracle Always Free VM path with persistent storage, systemd restart
policy, and Caddy HTTPS.

## 1. Push this folder to GitHub

```bash
cd lead-agent-saas
git init
git add .
git commit -m "Initial commit"
```
Create a new repo on GitHub, then:
```bash
git remote add origin https://github.com/<you>/lead-agent-saas.git
git push -u origin main
```

## 2. Deploy on the Oracle Always Free VM

Follow `ORACLE_DEPLOY.md`, then run `deploy/setup-server.sh`. The service listens
on port `8000`, runs under systemd, restarts after crashes and reboots, stores
SQLite on persistent disk, and is exposed through Caddy with HTTPS.

Point `api.dispatchpro.ai` at the VM and use it for payment callbacks, email
webhooks, and the Netlify API proxy.

## 2b. Netlify Functions are the canonical public payment/config API

The billing page must never show "Payment options are temporarily unavailable"
just because the stateful origin is asleep. Two stateless endpoints therefore
run as Netlify Functions and are served from the same site as the frontend:

| Public path | Netlify Function | Source |
| --- | --- | --- |
| `/api/payments/options` | `/.netlify/functions/payments-options` | `netlify/functions/payments-options.js` |
| `/api/config` | `/.netlify/functions/public-config` | `netlify/functions/public-config.js` |

Both build their payload from `payment-catalog.js`, which is also used by
`server.js`, so local Express and Netlify always return the same contract.
Stateful endpoints (`/api/billing/crypto/*`, `/auth/*`, `/leads/*`, …) continue
to proxy to the self-hosted backend through `netlify.toml`.

### Required Netlify site environment variables

Set these in **Site configuration → Environment variables**:

| Variable | Required? | Default if unset |
| --- | --- | --- |
| `BITCOIN_WALLET_ADDRESS` | Recommended | `3EiZ7FZ5r8LB9rdKWmhei5MsErPj58dK3k` |
| `ETHEREUM_WALLET_ADDRESS` | Recommended | `0xFFc40b1EcE21ce8A3b5e33caf95aA64bd8081330` |
| `BTC_USD_PRICE` | Optional | `70000` (live CoinGecko rate is used when reachable) |
| `ETH_USD_PRICE` | Optional | `3500` |
| `PAYPAL_CLIENT_ID` | Optional | card checkout panel stays hidden |
| `PAYPAL_PLAN_STARTER_MONTHLY` | Optional | card checkout panel stays hidden |
| `PAYPAL_PLAN_GROWTH_MONTHLY` | Optional | card checkout panel stays hidden |
| `EXPLORIUM_API_KEY` | Optional | prospecting reported as disabled |

No secrets (session secret, database, PayPal secret) are needed by the
functions — they are stateless and read-only.

### Deploying (no build step)

This repo publishes `public/` as-is; there is no build step. Always pass
`--no-build`, otherwise the Netlify CLI runs whatever build command is set in
the site UI and fails the deploy:

```bash
npx netlify deploy --prod --no-build --dir=public --functions=netlify/functions --site=<SITE_ID>
```

`npm run deploy:netlify` and `.github/workflows/netlify.yml` already do this.
If the site UI has a leftover build command (for example `hugo` from a
template), clear it under **Site configuration → Build & deploy → Build
settings**.

### Frontend API URL resolution

`public/api-base.js` is the single place where API URLs are resolved:

1. `window.DISPATCH_API_URL` from `runtime-config.js` (absolute origin, used by
   frontends hosted on a different site).
2. `<meta name="dispatch-api-base">`.
3. Same-origin relative paths (default) — resolved by `netlify.toml` on Netlify
   and by Express locally.

Stateless calls additionally fall back to the direct
`/.netlify/functions/...` path, so the BTC/ETH addresses still render even if a
redirect rule is missing.

The standalone `netlify-static/` drag-and-drop site is a *different* Netlify
site, so its `runtime-config.js` points at the canonical site
(`https://lead-saas-agent.netlify.app`). If you deploy it, add its origin to
`CORS_ORIGINS` on the stateful backend so crypto order/confirm calls succeed.

## 3. Optional alternative hosting

Railway doesn't use a checked-in blueprint file — set it
up from the dashboard:

1. Go to [railway.app](https://railway.app) -> **New Project** -> **Deploy from GitHub repo**
2. Select your repo — Railway detects Node automatically and runs `npm start`
3. Add a **Volume**: Settings -> Volumes -> mount at `/data`
4. Add env vars (same list as Render above), plus `DB_PATH=/data/data.db`
   and `TZ=Africa/Nairobi`
5. Deploy — Railway gives you a permanent `https://<project>.up.railway.app` URL
6. Same as step 5 above: update your callback/webhook URLs to the real domain

For persistent production data without a recurring hosting bill, use the Oracle
Always Free VM instructions in `ORACLE_DEPLOY.md`. You remain responsible for
operating-system updates, backups, TLS, and monitoring.

## 3c. Keep hosting options separate from customer options

The service supports BTC and ETH wallet checkout, PayPal, and M-Pesa where
credentials are configured. Customers can choose the payment method that fits
their market, while the same subscription entitlement and manual verification
rules apply across all methods. Hosting providers do not process or guarantee
payment; configure callbacks and webhooks against the permanent backend URL.

## 4. Switch from sandbox to real payments (when ready)

- `PAYPAL_ENV=live` with your live PayPal app credentials
- `MPESA_ENV=production` with your production Daraja shortcode/passkey
- Re-register the webhook/callback URLs under the live apps — sandbox and
  live webhooks are separate in both PayPal and Safaricom's dashboards
