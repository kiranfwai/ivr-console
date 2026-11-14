# Moving the IVR Console from AWS to the Agent37 VM

Plain-language runbook. Nothing here touches the live site until **Step 7**,
and Step 7 only happens with Mani's explicit OK at a quiet time.

## What moves, what stays

| Piece | Where it is now | After the move |
|---|---|---|
| IVR app (Next.js) | AWS EC2 `52.76.194.245`, `/opt/ivr-console` | Agent37 VM, `/opt/ivr-console` |
| Voice server (audio generation) | not running anywhere | Agent37 VM, private on `127.0.0.1:8765` |
| Database (Postgres) | separate host `PGHOST` (Oracle) | **unchanged** — the VM just connects to it |
| Audio files | Amazon S3 bucket `S3_BUCKET` | **unchanged** — needs an S3 key on the VM (see Step 3) |
| LiveKit, "sangam" | same AWS EC2 | **stay on AWS** — only the IVR moves |
| Domain `ivr.freedomwithai.com` | points at AWS | points at the VM (Step 7) |

## VM size

The voice model peaks around **7.3 GB RAM** and is CPU-hungry, and the app
build needs ~1.5 GB. Recommended: **4 vCPU / 16 GB RAM / 40 GB disk** (more
vCPU = faster audio). Minimum that works: 4 vCPU / 12 GB / 30 GB.

## Step 0 — what we need first (from Mani / Animesh)

- SSH access to the VM: host/IP, username, key file saved on the laptop.
- A hostname for the trial, e.g. `ivr2.freedomwithai.com`, pointed (DNS A record) at the VM — or use `<vm-ip>.nip.io` for a first look.
- An **S3 access key** (IAM user with read/write on the audio bucket). The AWS server uses its built-in role; the VM can't.
- Whoever manages the database host: allow the VM's outbound IP (printed by Step 1).

## Step 1 — prepare the VM (no secrets, no risk)

```bash
scp -i <vm-key> deploy/agent37/provision-vm.sh <user>@<vm>:~
ssh -i <vm-key> <user>@<vm> 'sudo DOMAINS="ivr2.freedomwithai.com" bash ~/provision-vm.sh'
```
Installs Node 20 (same as AWS), Caddy (automatic HTTPS), the app code, a
systemd service (not started yet). Prints the VM's outbound IP.

## Step 2 — voice server (audio generation)

```bash
ssh -i <vm-key> <user>@<vm> 'sudo VOICE_LOCAL_ONLY=1 bash /opt/ivr-console/voice-server/setup.sh'
```
Downloads the ~3 GB model on first run, starts `ivr-voice`, private only.

## Step 3 — copy the live settings (from the laptop)

```bash
export AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...   # the S3 key
VM="<user>@<vm>" VM_KEY=<vm-key> TRIAL_URL="https://ivr2.freedomwithai.com" \
  bash deploy/agent37/copy-env.sh
```
Pipes AWS's settings straight to the VM with **WORKER_DISABLED=1** (the VM
cannot call or message anyone during the trial), the trial URL, and the voice
server link.

## Step 4 — build and start

```bash
ssh -i <vm-key> <user>@<vm> 'sudo bash /opt/ivr-console/deploy/agent37/deploy-app.sh'
```

## Step 5 — trial checks (Mani)

- Open the trial URL, log in, click through every page (light + dark).
- Audios → Generate audio: add a voice (with permission), make one short take, save it.
- Database reachable (pages show real data). If they don't, the DB allow-list (Step 0) is missing.

## Step 6 — before the switch

- Pick a quiet time. Check no calls are running (deploy-app.sh refuses to restart while busy).
- Lower the DNS TTL of `ivr.freedomwithai.com` to 60 s a day before, if possible.

## Step 7 — the switch (only with Mani's OK)

1. AWS: stop the IVR workers so only one server ever dials —
   add `WORKER_DISABLED=1` to `/etc/ivr-console/env` on AWS, `sudo systemctl restart ivr-console`.
2. VM: in `/etc/ivr-console/env` set `PUBLIC_BASE_URL=https://ivr.freedomwithai.com`
   and remove `WORKER_DISABLED=1`; add `ivr.freedomwithai.com` to `DOMAINS` and
   re-run provision-vm.sh (Caddy picks up the certificate); `FORCE=1` deploy-app.sh.
3. DNS: point `ivr.freedomwithai.com` at the VM.
4. Watch: one test call to Mani's phone, one ₹1 top-up, the logs
   (`journalctl -u ivr-console -f`), Past runs, Call reports.

## Rollback (any time in the first week)

Point DNS back at AWS, remove `WORKER_DISABLED=1` on AWS and restart it, set
`WORKER_DISABLED=1` on the VM. AWS keeps its code and settings untouched for a week.

## Known differences vs AWS

- Region is probably Europe: every Plivo callback travels farther. Test-call quality is checked in Step 5.
- No uptime guarantee from Agent37, and **a VM sleeps if the Agent37 balance runs out** — keep the balance topped up.
