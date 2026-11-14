#!/usr/bin/env bash
# One-time setup of the IVR Console on a fresh Ubuntu VM (built for the
# Agent37 VM; works on any Ubuntu 22.04+). Safe to re-run.
#
#   sudo DOMAINS="ivr2.freedomwithai.com" bash provision-vm.sh
#
# DOMAINS  space-separated hostnames Caddy should serve with automatic HTTPS.
#          Their DNS must already point at this VM (or use <ip>.nip.io for a
#          first test). Leave empty to serve plain HTTP on :80 only.
# REF      git ref to deploy (default: main).
#
# What it does NOT do: write secrets. /etc/ivr-console/env is created empty
# (mode 0640) and filled by copy-env.sh from the laptop. The app is installed
# but only started once that file exists.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

DOMAINS="${DOMAINS:-}"
REF="${REF:-main}"
APP=/opt/ivr-console
REPO=https://github.com/kiranfwai/ivr-console.git
ENV_FILE=/etc/ivr-console/env

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https postgresql-client

# Node 20 — the same major version the AWS server runs (v20.20.x).
if ! command -v node >/dev/null || ! node -v | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -q nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

echo "== user + code"
id ivr >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/ivr --shell /bin/bash ivr
mkdir -p /etc/ivr-console /var/www/downloads
if [ ! -d "$APP/.git" ]; then
  git clone -q "$REPO" "$APP"
fi
git -C "$APP" config --global --add safe.directory "$APP" || true
git -C "$APP" fetch -q origin
git -C "$APP" reset -q --hard "origin/$REF"
chown -R ivr:ivr "$APP"
if [ ! -f "$ENV_FILE" ]; then
  install -m 0640 -o root -g ivr /dev/null "$ENV_FILE"
fi

echo "== service (installed; started once the env file is filled)"
cat > /etc/systemd/system/ivr-console.service <<EOF
[Unit]
Description=IVR Console (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ivr
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
TimeoutStartSec=30
# Give in-flight requests a moment instead of a hard kill on restart.
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ivr-console >/dev/null

echo "== https (Caddy)"
# Mirrors the AWS nginx site: 25 MB uploads, 120 s upstream timeout, the
# x-middleware-subrequest header stripped (CVE-2025-29927 belt-and-braces),
# and /downloads/ served as attachments.
SITE_ADDR="${DOMAINS:-:80}"
cat > /etc/caddy/Caddyfile <<EOF
$SITE_ADDR {
	request_body {
		max_size 25MB
	}
	handle_path /downloads/* {
		root * /var/www/downloads
		header Content-Disposition attachment
		file_server
	}
	handle {
		reverse_proxy 127.0.0.1:3000 {
			header_up -x-middleware-subrequest
			transport http {
				read_timeout 120s
			}
		}
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl restart caddy

echo
echo "Done. Next, from the laptop:  copy-env.sh  (fills $ENV_FILE), then on this VM:"
echo "  sudo bash $APP/deploy/agent37/deploy-app.sh"
echo "Outbound IP of this VM (add to the database allow-list): $(curl -fsS -4 https://ifconfig.me || echo unknown)"
