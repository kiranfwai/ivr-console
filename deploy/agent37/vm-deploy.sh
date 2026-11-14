#!/usr/bin/env bash
# Runs ON the Agent37 VM (as root). Builds and (re)starts the IVR container.
# Normally started from the laptop with:  bash deploy/agent37/vm.sh deploy
#
#   REF=main   git ref to deploy
#   FORCE=1    restart even if calls are running (a restart cuts live calls)
#
# The new image is built while the old container keeps serving; the swap at
# the end is a few seconds. Nothing here touches the other app on this VM.
set -euo pipefail

# `git reset` below rewrites this very file; run from a copy so bash doesn't
# read a half-changed script.
if [ "${IVR_DEPLOY_COPY:-}" != 1 ]; then
  cp "$0" /tmp/ivr-vm-deploy.sh
  IVR_DEPLOY_COPY=1 exec bash /tmp/ivr-vm-deploy.sh "$@"
fi

BASE=/root/apps/ivr
SRC=$BASE/src
ENV_FILE=$BASE/env
COMPOSE=(docker compose -f "$SRC/deploy/agent37/compose.ivr.yml")
REF="${REF:-main}"
[ -s "$ENV_FILE" ] || { echo "$ENV_FILE is empty: run 'vm.sh env' from the laptop first"; exit 1; }

echo "== code ($REF)"
git -C "$SRC" fetch -q origin
git -C "$SRC" reset -q --hard "origin/$REF"
git -C "$SRC" log --oneline -1

echo "== build (old container keeps serving)"
"${COMPOSE[@]}" build --pull

# Refuse to swap while calls are live, unless this VM is in trial mode (no worker).
if [ "${FORCE:-0}" != 1 ] && ! grep -qx 'WORKER_DISABLED=1' "$ENV_FILE" \
   && [ -n "$(docker ps -q -f name='^ivr$')" ]; then
  busy=$(docker exec ivr node -e '
    const { Client } = require("pg");
    const ssl = /^(require|true|1)$/i.test(process.env.PGSSL || "") ? { rejectUnauthorized: false } : undefined;
    const c = new Client({ ssl });
    c.connect()
      .then(() => c.query(`SELECT (SELECT count(*) FROM bulk_job WHERE status = $1)
                                 + (SELECT count(*) FROM wallet_txn WHERE type = $2
                                    AND created_at > now() - $3::interval) AS n`, ["running", "charge", "5 minutes"]))
      .then(r => { console.log(r.rows[0].n); return c.end(); })
      .catch(() => { console.log("?"); process.exit(0); });' 2>/dev/null || echo "?")
  if [ "$busy" != "0" ]; then
    echo "NOT restarting: live work detected ($busy running jobs / recent calls, or DB unreachable)."
    echo "The new image is built; re-run when quiet, or FORCE=1."
    exit 2
  fi
fi

echo "== swap"
"${COMPOSE[@]}" up -d --remove-orphans
for i in $(seq 1 45); do
  state=$(docker inspect -f '{{.State.Health.Status}}' ivr 2>/dev/null || echo missing)
  [ "$state" = healthy ] && break
  sleep 2
done
echo "container: $state"
docker image prune -f >/dev/null
docker logs --since 3m ivr 2>&1 | grep -E "Ready|rror" | tail -8 || true
echo "WORKER_DISABLED=$(grep -s '^WORKER_DISABLED=' "$ENV_FILE" | cut -d= -f2)  (1 = trial: this VM sends no calls or messages)"
[ "$state" = healthy ]
