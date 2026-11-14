#!/usr/bin/env bash
# Build and (re)start the IVR Console on the VM. Safe to re-run; this is also
# the routine deploy after the move.
#
#   sudo bash /opt/ivr-console/deploy/agent37/deploy-app.sh          # main
#   sudo REF=feat/x bash /opt/ivr-console/deploy/agent37/deploy-app.sh
#
# It refuses to restart if bulk jobs are running or calls were billed in the
# last 5 minutes (a restart cuts live calls) unless FORCE=1.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
APP=/opt/ivr-console
REF="${REF:-main}"
ENV_FILE=/etc/ivr-console/env
[ -s "$ENV_FILE" ] || { echo "$ENV_FILE is empty — run copy-env.sh from the laptop first"; exit 1; }

set -a; . "$ENV_FILE"; set +a
if [ "${FORCE:-0}" != 1 ] && [ "${WORKER_DISABLED:-0}" != 1 ]; then
  busy=$(PGPASSWORD="$PGPASSWORD" PGSSLMODE="${PGSSL:+require}" psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" -Atc \
    "SELECT (SELECT count(*) FROM bulk_job WHERE status='running') + (SELECT count(*) FROM wallet_txn WHERE type='charge' AND created_at > now() - interval '5 minutes')" 2>/dev/null || echo "?")
  if [ "$busy" != "0" ]; then
    echo "Not restarting: live work detected ($busy running jobs / recent calls, or DB unreachable). Re-run when quiet, or FORCE=1."
    exit 2
  fi
fi

echo "== code ($REF)"
sudo -u ivr git -C "$APP" fetch -q origin
sudo -u ivr git -C "$APP" reset -q --hard "origin/$REF"
sudo -u ivr git -C "$APP" log --oneline -1

echo "== build"
cd "$APP"
sudo -u ivr npm ci --no-audit --no-fund
sudo -u ivr npm run build

echo "== restart"
systemctl restart ivr-console
for i in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:3000/login && break; sleep 2
done
systemctl is-active ivr-console
journalctl -u ivr-console --since "-2 min" --no-pager | grep -E "Ready|started|rror" | tail -8
echo "WORKER_DISABLED=${WORKER_DISABLED:-0}  (1 = trial: no calls/messages are sent from this VM)"
