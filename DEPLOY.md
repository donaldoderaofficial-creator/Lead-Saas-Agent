# Deploying lead-agent-saas

## Before you deploy

This app writes to SQLite for pending leads and completed reports. Production
uses the Oracle Always Free VM path with persistent storage, systemd restart
policy, and Caddy HTTPS.

For the checked-in Netlify frontend deployment flow, export
`NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`, then run `npm run deploy`.

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
