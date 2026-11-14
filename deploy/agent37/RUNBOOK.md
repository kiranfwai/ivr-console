# IVR Console on the Agent37 VM (containers)

Plain-language runbook. Nothing here touches the live AWS site until **Step 6**,
and Step 6 only happens with Mani's explicit OK at a quiet time.

## The VM

| | |
|---|---|
| Agent37 VM id | `ezyzcq0mur` "apps-mumbai" (2 vCPU / 4 GB RAM / 50 GB disk, region ap-south = Mumbai; DB round trip ~20 ms. A US VM measured 257 ms: never use region us for this app) |
| Outbound IP | `148.113.0.143` (DB currently accepts it without an allow-list) |
| Persistent disk | only `/root` (50 GB). Docker already stores everything in `/root/docker` |
| Reaching it | no SSH / no public IP. Commands go through Agent37's API (`vm.sh run`); web traffic only via Agent37 public URLs (`https://<prefix>-ezyzcq0mur.agent37.app`) |

## Sharing the VM with other apps

Every app is its **own container in its own compose project**:

| App | Folder on VM | Host port | Public URL | Limits |
|---|---|---|---|---|
| IVR Console | `/root/apps/ivr/` | 3001 | `https://ivr-ezyzcq0mur.agent37.app` | 1.4 GB RAM, 1.5 CPU |
| (next app) | `/root/apps/<name>/` | 3002, 3003, ... | `https://<name>-ezyzcq0mur.agent37.app` | set in its compose file |

- Separate compose projects = separate private networks: the apps can't see each other.
- Memory/CPU caps: one app spiking or leaking can't take the other down.
- Each app has its own settings file (`/root/apps/<name>/env`, mode 600) and its own deploy.
- Memory budget on 4 GB: IVR 1.4 GB + other app <= ~1.5 GB, leaving room for the system
  and for builds. **A build (~1.5 GB extra for a few minutes) should not run while
  the other app is under heavy load.**

## Step 0: before the trial

- Database: whoever manages the DB host allows `15.204.103.71`.
- S3 key (IAM user, read/write on the audio bucket) if audio upload must work on the trial.

## Step 1: one-time setup (laptop)

```bash
bash deploy/agent37/vm.sh setup     # folders + code checkout on the VM
bash deploy/agent37/vm.sh url       # creates https://ivr-ezyzcq0mur.agent37.app
```

## Step 2: settings (laptop)

```bash
TRIAL_URL=https://ivr-ezyzcq0mur.agent37.app bash deploy/agent37/vm.sh env
```
Copies the 20 live settings from AWS straight to the VM (nothing saved on the laptop),
with **WORKER_DISABLED=1** (the VM cannot call or message anyone), the trial URL, and
PGPOOL_MAX=10 (small DB pool while AWS is still live). Add an S3 key by exporting
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` first.

## Step 3: build and start (laptop)

```bash
REF=main bash deploy/agent37/vm.sh deploy
bash deploy/agent37/vm.sh status
```
Builds the image while any old container keeps serving, then swaps (a few seconds).
Refuses to swap while calls are running unless `FORCE=1` (only when workers are on).

## Step 4: trial checks (Mani)

Open the trial URL, log in, click every page in light + dark. Pages showing real data
= database reachable.

## LIVE since 2026-11-14 19:00 IST

- `ivr.freedomwithai.com` still resolves to AWS; AWS nginx (`/etc/nginx/sites-enabled/ivr-console-new`)
  forwards everything to `https://ivr-ezyzcq0mur.agent37.app` via `/etc/nginx/snippets/ivr-to-vm.conf`.
  Backup of the old site: `/etc/nginx/ivr-console-new.bak-20261114-1330`.
- AWS IVR app STOPPED + disabled (`systemctl stop/disable ivr-console`, ~19:15 IST); its code + env kept
  for rollback (env backup `/etc/ivr-console/env.bak-20261114-1329`). Both AWS nginx sites forward to the VM.
- Audio uploads: `AUDIO_STORAGE=local` -> `/root/apps/ivr/media` on the VM, served at `/audios/u/<file>`.
  Older audio stays on S3 (public URLs, keep playing). No AWS key needed.
- `PGPOOL_MAX=15`, same as AWS (DB connection limit).
- VM runs workers (`WORKER_DISABLED=0`, `PGPOOL_MAX=15`, `PUBLIC_BASE_URL=https://ivr.freedomwithai.com`).
- Rollback in 1 minute: on AWS restore the nginx backup + reload, delete `WORKER_DISABLED=1` from the
  env, `systemctl enable --now ivr-console`; then `WORKER_DISABLED=1 TRIAL_URL=https://ivr.freedomwithai.com bash deploy/agent37/vm.sh env`
  and force-recreate the VM container.

## Step 5: domain decision (to drop AWS entirely)

`ivr.freedomwithai.com` **cannot** simply be pointed at the VM: Agent37 rejects
hostnames it doesn't own (tested: 403). Options:
1. Register a separate, dedicated domain with Agent37 (whole domain delegated to them;
   needs $50 of total top-ups). The IVR then lives at e.g. `ivr.<new-domain>`.
2. Keep `ivr.freedomwithai.com` as a redirect to the Agent37 URL (Plivo/Cashfree
   callbacks use the Agent37 URL directly via PUBLIC_BASE_URL).

## Step 6: the switch (only with Mani's OK, no calls running)

1. AWS: add `WORKER_DISABLED=1` to `/etc/ivr-console/env`, `sudo systemctl restart ivr-console`.
2. VM: `WORKER_DISABLED=0 PGPOOL_MAX=15 TRIAL_URL=<final url> bash deploy/agent37/vm.sh env`,
   then `FORCE=1 bash deploy/agent37/vm.sh deploy`.
3. Domain per Step 5.
4. Watch: one test call to Mani's phone, one ₹1 top-up, `vm.sh logs`, Past runs, Call reports.

## Rollback (first week)

`WORKER_DISABLED=1 ... vm.sh env` + deploy on the VM; remove `WORKER_DISABLED=1` on AWS and
restart it; point the domain back. AWS keeps its code and settings for a week.

## Known differences vs AWS

- Region is US: Plivo callbacks travel a bit farther; checked with a test call in Step 6.
- No uptime guarantee; **the VM sleeps if the Agent37 balance runs out**: keep it topped up.
- After an Agent37 restart, containers come back via `restart: unless-stopped`.
