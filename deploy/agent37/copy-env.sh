#!/usr/bin/env bash
# Run on the LAPTOP. Copies the live settings from the AWS server straight to
# the new VM (server → laptop pipe → server; nothing is written to the laptop's
# disk), with the changes the new VM needs:
#
#   WORKER_DISABLED=1                trial mode — the VM sends no calls or messages
#   PUBLIC_BASE_URL=<trial url>      Plivo / Cashfree callbacks for test calls
#   TTS_SERVER_URL=http://127.0.0.1:8765, TTS_SERVER_TOKEN=<from the voice server>
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  appended ONLY if given (see below)
#
#   VM="ivr@1.2.3.4" VM_KEY=~/Downloads/agent37-vm.pem \
#   TRIAL_URL="https://ivr2.freedomwithai.com" bash copy-env.sh
#
# S3: the AWS server reaches S3 through its instance role, which a VM outside
# AWS doesn't have. Give an IAM key with access to the bucket by exporting
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in this shell before running, or
# audio uploads / generated audio will fail on the VM (calls still work).
set -euo pipefail
: "${VM:?set VM=user@host for the new VM}"
: "${TRIAL_URL:?set TRIAL_URL=https://<trial hostname>}"
EC2="${EC2:-ubuntu@52.76.194.245}"
EC2_KEY="${EC2_KEY:-$HOME/Downloads/ivr-key.pem}"
VM_SSH=(ssh -o ConnectTimeout=15 ${VM_KEY:+-i "$VM_KEY"} "$VM")

voice_token="$("${VM_SSH[@]}" "sudo grep -s ^VOICE_TOKEN= /etc/ivr-voice/env | cut -d= -f2" || true)"

ssh -o ConnectTimeout=15 -i "$EC2_KEY" "$EC2" "sudo cat /etc/ivr-console/env" \
| grep -vE '^(WORKER_DISABLED|PUBLIC_BASE_URL|TTS_SERVER_URL|TTS_SERVER_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=' \
| {
    cat
    echo "WORKER_DISABLED=1"
    echo "PUBLIC_BASE_URL=$TRIAL_URL"
    if [ -n "$voice_token" ]; then
      echo "TTS_SERVER_URL=http://127.0.0.1:8765"
      echo "TTS_SERVER_TOKEN=$voice_token"
    fi
    if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
      echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
      echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
    fi
  } \
| "${VM_SSH[@]}" "sudo install -m 0640 -o root -g ivr /dev/stdin /etc/ivr-console/env && sudo sed 's/=.*//' /etc/ivr-console/env | sort | tr '\n' ' '"
echo
echo "Copied. Voice server linked: $([ -n "$voice_token" ] && echo yes || echo 'no (run voice setup first, then re-run this)')"
echo "S3 key added: $([ -n "${AWS_ACCESS_KEY_ID:-}" ] && echo yes || echo 'NO — audio uploads will fail until added')"
