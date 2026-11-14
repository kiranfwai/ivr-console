#!/usr/bin/env bash
# Run on the LAPTOP (Git Bash). Drives the IVR container on the Agent37 VM
# through Agent37's API (the VM has no direct SSH/IP from outside).
#
#   bash deploy/agent37/vm.sh setup                 # one-time: folders + code checkout
#   TRIAL_URL=https://ivr-<id>.agent37.app bash deploy/agent37/vm.sh env
#   REF=deploy/agent37-app bash deploy/agent37/vm.sh deploy
#   bash deploy/agent37/vm.sh url                   # create the public HTTPS URL (once)
#   bash deploy/agent37/vm.sh status | logs | run "<shell command>"
#
# Needs the API key in ~/.agent37_key. VM id defaults to the IVR VM.
set -euo pipefail
VM_ID="${VM_ID:-uwzzlktkge}"
KEY="$(cat "$HOME/.agent37_key")"
BASE=/root/apps/ivr
REPO=https://github.com/kiranfwai/ivr-console.git
PY=$(for p in python python3; do "$p" -c "" 2>/dev/null && { echo "$p"; break; }; done)

# run "<command>" -> prints stdout/stderr of the command on the VM, exits with its code
run() {
  local body out
  body=$(printf '%s' "$1" | "$PY" -c 'import json,sys; print(json.dumps({"command": sys.stdin.read()}))')
  out=$(curl -sS -m "${EXEC_TIMEOUT:-120}" -X POST "https://sandbox.agent37.app/v1/instances/$VM_ID/exec" \
        -H "X-Agent37-Key: $KEY" -H "Content-Type: application/json" --data-binary "$body")
  printf '%s' "$out" | "$PY" -c '
import json,sys
r=json.load(sys.stdin); sys.stdout.reconfigure(encoding="utf-8", errors="replace"); sys.stderr.reconfigure(encoding="utf-8", errors="replace")
sys.stdout.write(r.get("stdout") or ""); sys.stderr.write(r.get("stderr") or "")
sys.exit(r.get("exit_code") or 0)'
}

case "${1:-}" in
  run) run "$2" ;;

  setup)
    run "set -e
      mkdir -p $BASE && chmod 700 $BASE
      [ -d $BASE/src/.git ] || git clone -q $REPO $BASE/src
      [ -f $BASE/env ] || install -m 600 /dev/null $BASE/env
      docker info --format 'docker ok, data on {{.DockerRootDir}}'
      git -C $BASE/src log --oneline -1" ;;

  env)
    : "${TRIAL_URL:?set TRIAL_URL=https://<public url of the VM>}"
    EC2="${EC2:-ubuntu@52.76.194.245}"; EC2_KEY="${EC2_KEY:-$HOME/Downloads/ivr-key.pem}"
    # AWS settings -> this pipe -> VM. Nothing is written to the laptop's disk or printed.
    b64=$(ssh -o ConnectTimeout=15 -i "$EC2_KEY" "$EC2" "sudo cat /etc/ivr-console/env" \
      | grep -vE '^(WORKER_DISABLED|PUBLIC_BASE_URL|PGPOOL_MAX|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=' \
      | { cat
          echo "WORKER_DISABLED=${WORKER_DISABLED:-1}"
          echo "PUBLIC_BASE_URL=$TRIAL_URL"
          echo "PGPOOL_MAX=${PGPOOL_MAX:-10}"
          if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
            echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"; echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
          fi; } \
      | base64 -w0)
    [ -n "$b64" ] || { echo "could not read the AWS settings"; exit 1; }
    run "set -e; printf '%s' '$b64' | base64 -d > $BASE/env.new && chmod 600 $BASE/env.new && mv $BASE/env.new $BASE/env
      echo \"settings on VM: \$(grep -c = $BASE/env) values: \$(cut -d= -f1 $BASE/env | tr '\n' ' ')\"
      grep -E '^(WORKER_DISABLED|PUBLIC_BASE_URL|PGPOOL_MAX)=' $BASE/env"
    echo "S3 key added: $([ -n "${AWS_ACCESS_KEY_ID:-}" ] && echo yes || echo 'NO: audio uploads will fail until added')" ;;

  deploy)
    # Build takes several minutes: start it detached on the VM, then follow the log.
    run "set -e; git -C $BASE/src fetch -q origin && git -C $BASE/src show 'origin/${REF:-main}:deploy/agent37/vm-deploy.sh' > /tmp/ivr-vm-deploy.sh
      (REF='${REF:-main}' FORCE='${FORCE:-0}' IVR_DEPLOY_COPY=1 setsid nohup bash /tmp/ivr-vm-deploy.sh > $BASE/deploy.log 2>&1; echo \"EXIT \$?\" >> $BASE/deploy.log) < /dev/null > /dev/null 2>&1 &
      echo started"
    for i in $(seq 1 120); do
      sleep 10
      last=$(run "tail -1 $BASE/deploy.log" 2>/dev/null || true)
      case "$last" in EXIT*) break ;; esac
      printf '.'
    done
    echo; run "grep -vE '^#[0-9]+ (sha256|resolve|transferring|DONE|CACHED|\\[internal\\])' $BASE/deploy.log | tail -25" ;;

  url)
    curl -sS -m 30 -X POST "https://api.agent37.com/v1/instances/$VM_ID/public-ports" \
      -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -d '{"port":3001,"prefix":"ivr","label":"IVR Console"}'; echo ;;

  status) run "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'; echo; docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'; echo; free -h | sed -n 1,2p; df -h /root | tail -1" ;;
  logs)   run "docker logs --tail ${N:-80} ivr 2>&1" ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
