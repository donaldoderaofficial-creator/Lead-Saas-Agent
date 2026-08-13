#!/usr/bin/env bash
# Run this ON the Oracle Cloud VM after SSH'ing in (Ubuntu 22.04/24.04 assumed).
#
# Two modes:
#   From a GitHub repo:  bash setup-server.sh https://github.com/you/lead-agent-saas.git leadagent.duckdns.org
#   From an scp'd folder: bash setup-server.sh ~/lead-agent-saas leadagent.duckdns.org
set -euo pipefail

SOURCE="${1:?Usage: bash setup-server.sh <repo-url-or-local-folder> <domain>}"
DOMAIN="${2:?Usage: bash setup-server.sh <repo-url-or-local-folder> <domain>}"
APP_DIR="/opt/lead-agent-saas"

echo "== 1/6: System update =="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "== 2/6: Install Node.js LTS, git, build tools (for better-sqlite3's native build) =="
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git build-essential

echo "== 3/6: Get the app =="
if [[ "$SOURCE" == http*://* ]]; then
  # Git repo mode
  if [ -d "$APP_DIR" ]; then
    echo "App dir already exists, pulling latest instead of cloning"
    cd "$APP_DIR" && git pull
  else
    sudo git clone "$SOURCE" "$APP_DIR"
    sudo chown -R "$USER:$USER" "$APP_DIR"
    cd "$APP_DIR"
  fi
else
  # Local folder mode (uploaded via scp)
  LOCAL_PATH="${SOURCE/#\~/$HOME}"
  if [ ! -d "$LOCAL_PATH" ]; then
    echo "Error: $LOCAL_PATH not found. Did the scp upload finish?"
    exit 1
  fi
  echo "Copying $LOCAL_PATH to $APP_DIR"
  sudo rm -rf "$APP_DIR"
  sudo cp -r "$LOCAL_PATH" "$APP_DIR"
  sudo chown -R "$USER:$USER" "$APP_DIR"
  cd "$APP_DIR"
fi
npm install --production

if [ ! -f .env ]; then
  cp .env.example .env
  echo ">>> Created .env from the example — you MUST edit it with real values before continuing:"
  echo ">>>   nano $APP_DIR/.env"
  echo ">>> Fill in PayPal/M-Pesa credentials, SESSION_SECRET, DB_PATH=/opt/lead-agent-saas/data.db"
  echo ">>> Then re-run this script, or continue manually from step 4 in ORACLE_DEPLOY.md."
  exit 0
fi

echo "== 4/6: systemd service (keeps the app running, restarts on crash/reboot) =="
sudo tee /etc/systemd/system/leadagent.service > /dev/null <<EOF
[Unit]
Description=Lead Agent SaaS
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=$(which node) $APP_DIR/server.js
Restart=on-failure
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable leadagent
sudo systemctl restart leadagent

echo "== 5/6: Firewall (ufw) — allow SSH, HTTP, HTTPS only =="
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "== 6/6: Caddy as reverse proxy — automatic free HTTPS via Let's Encrypt =="
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -y && sudo apt-get install -y caddy

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
$DOMAIN {
    reverse_proxy localhost:3000
}
EOF
sudo systemctl restart caddy

echo ""
echo "Done. Your app should be live at: https://$DOMAIN"
echo "Note: this only works if $DOMAIN's DNS already points at this VM's public IP."
echo "Check status any time with: sudo systemctl status leadagent"
echo "Check logs with:            sudo journalctl -u leadagent -f"
