# Deploying to Oracle Cloud Always Free

This gets you a permanent, genuinely free server — but you're managing it
yourself. Budget ~30-45 minutes the first time.

## 1. Create the account and VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (a card is required
   for identity verification, but Always Free resources never bill unless you
   explicitly upgrade to a paid plan).
2. In the console: **Compute → Instances → Create Instance**
3. Name it (e.g. `lead-agent-saas`)
4. Under **Image and shape**, pick:
   - Image: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere/ARM, Always Free eligible — up to
     4 OCPUs / 24GB RAM free, far more than you need; 1 OCPU / 6GB is plenty)
5. Under **Networking**, leave the defaults (creates a new VCN with a public
   subnet and public IP automatically)
6. Under **Add SSH keys**, choose "Generate a key pair" and **download the
   private key** — you can't get it again later
7. Click **Create**. Wait ~1 minute for it to boot, then copy its **Public IP**
   from the instance details page

## 2. Open the firewall for web traffic

Oracle blocks ports by default at the network level (separate from the VM's
own firewall).

1. On the instance page, click the subnet link under **Primary VNIC**
2. Click the default **Security List**
3. **Add Ingress Rules** twice:
   - Source CIDR `0.0.0.0/0`, Destination Port `80` (HTTP)
   - Source CIDR `0.0.0.0/0`, Destination Port `443` (HTTPS)

## 3. Get a free domain pointed at your VM

PayPal and M-Pesa both require HTTPS callback URLs, and a trusted certificate
needs a real domain — a bare IP address can't get one.

1. Go to [duckdns.org](https://www.duckdns.org), sign in (free), and create a
   subdomain, e.g. `leadagent.duckdns.org`
2. Point it at your VM's public IP from step 1

(Already have a real domain? Just point an A record at the VM's IP instead.)

## 4. Connect and run the setup script

```bash
chmod 600 ~/Downloads/your-key.pem
ssh -i ~/Downloads/your-key.pem ubuntu@<your-vm-public-ip>
```

Once connected:

```bash
curl -O https://raw.githubusercontent.com/<you>/lead-agent-saas/main/deploy/setup-server.sh
bash setup-server.sh https://github.com/<you>/lead-agent-saas.git leadagent.duckdns.org
```

(No GitHub repo yet? `scp` the project folder up instead: from your own
machine, `scp -i your-key.pem -r lead-agent-saas ubuntu@<vm-ip>:~/`, then SSH
in and run the script pointing at that local folder instead of a repo URL —
ask me and I'll adjust the script for that path.)

The script installs Node, clones the app, and stops partway through the first
run so you can fill in real credentials:

```bash
nano /opt/lead-agent-saas/.env
```

Fill in your real PayPal, M-Pesa, `SESSION_SECRET`, and set:
```
DB_PATH=/opt/lead-agent-saas/data.db
```

Then re-run the same command from before — it picks up from where it left
off, sets up the systemd service (so the app survives reboots and crashes),
locks down the firewall, and installs Caddy for automatic free HTTPS.

## 5. Verify

- `https://leadagent.duckdns.org` should load your site with a valid padlock
- `sudo systemctl status leadagent` — confirms the app is running
- `sudo journalctl -u leadagent -f` — live logs if something's wrong

## 6. Point your webhooks at the real domain

Update in the PayPal and Safaricom dashboards, and in your `.env`:
```
MPESA_CALLBACK_URL=https://leadagent.duckdns.org/payments/mpesa/callback
```
Then: `sudo systemctl restart leadagent`

## Ongoing maintenance (the tradeoff vs. Render)

- Security updates: `sudo apt-get update && sudo apt-get upgrade -y` periodically
- Deploying new code: `cd /opt/lead-agent-saas && git pull && npm install --production && sudo systemctl restart leadagent`
- If the VM ever reboots, everything restarts automatically — no action needed
