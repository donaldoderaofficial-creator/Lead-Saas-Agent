# Deploying lead-agent-saas

## Before you deploy

This app writes to a SQLite file (`data.db`) for pending leads and completed
reports. **Both Render and Railway wipe the filesystem on every redeploy
unless you attach a persistent disk/volume.** Skip that step and every paid
report vanishes the next time you push code. Both setups below handle it.

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

## 2. Deploy on Render

`render.yaml` in this folder already defines the service, including a 1GB
persistent disk mounted at `/data`.

1. Go to [dashboard.render.com](https://dashboard.render.com) -> **New** -> **Blueprint**
2. Connect the GitHub repo you just pushed — Render reads `render.yaml` automatically
3. It will prompt you for the env vars marked `sync: false` (your real credentials).
   Fill in: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`,
   `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
   `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` (use the Render URL you're given +
   `/payments/mpesa/callback`), plus `COMPLIANCE_MPESA_NUMBER`,
   `COMPLIANCE_BITCOIN_ADDRESS`, and `COMPLIANCE_ETHEREUM_ADDRESS`.
   Keep those payment destinations in the provider dashboard, not in Git.
4. Deploy — you'll get a permanent `https://lead-agent-saas.onrender.com` URL
5. Update `MPESA_CALLBACK_URL` and your PayPal webhook to point at that real URL

Note: Render's free tier spins down after inactivity and takes ~30s to wake
on the next request — fine for testing, worth upgrading to a paid instance
before real customers depend on it.

## 3. Deploy on Railway (alternative)

Railway doesn't use a checked-in blueprint file the way Render does — set it
up from the dashboard:

1. Go to [railway.app](https://railway.app) -> **New Project** -> **Deploy from GitHub repo**
2. Select your repo — Railway detects Node automatically and runs `npm start`
3. Add a **Volume**: Settings -> Volumes -> mount at `/data`
4. Add env vars (same list as Render above), plus `DB_PATH=/data/data.db`
   and `TZ=Africa/Nairobi`
5. Deploy — Railway gives you a permanent `https://<project>.up.railway.app` URL
6. Same as step 5 above: update your callback/webhook URLs to the real domain

## 4. Switch from sandbox to real payments (when ready)

- `PAYPAL_ENV=live` with your live PayPal app credentials
- `MPESA_ENV=production` with your production Daraja shortcode/passkey
- Re-register the webhook/callback URLs under the live apps — sandbox and
  live webhooks are separate in both PayPal and Safaricom's dashboards
