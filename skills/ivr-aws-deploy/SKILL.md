---
name: ivr-aws-deploy
description: Deploy code changes for the IVR Console app to its AWS EC2 server. Use this skill whenever someone wants to push, deploy, release, or "build the new changes in AWS" for the ivr-console / FWAI IVR project — including after merging to main, applying a hotfix, changing environment variables, or rolling back. Covers the full manual deploy procedure (SSH in, pull, build, restart), where the app and config live, and the gotchas specific to this server (low-memory build, env file outside git, hard-reset to match the repo). Trigger this even when the request is casual like "deploy the latest" or "update the server."
---

# Deploy IVR Console to AWS EC2

This skill deploys the **ivr-console** (FWAI IVR) Next.js app to its single AWS EC2
server. Deploys are **manual** — pushing to GitHub does NOT auto-deploy. After code
is on `main`, someone runs the steps below on the server to make it live.

## The server (facts you need)

- **Host / SSH:** `ssh -i ivr-key.pem ubuntu@13.212.188.126` (needs the `ivr-key.pem` private key)
- **Provider:** AWS EC2, region Asia Pacific (Singapore) `ap-southeast-1`
- **Instance:** `ivr-console`, ID `i-0f21868bcc0c3b836`, type t3.micro (1 GiB RAM + 2 GB swap), Ubuntu
- **App lives at:** `/opt/ivr-console`
- **Runs as:** systemd service `ivr-console` (on port 3000), behind nginx with HTTPS
- **Public URL:** `https://13.212.188.126.nip.io`
- **Repo:** `https://github.com/kiranfwai/ivr-console` (branch `main`)
- **Env file:** `/etc/ivr-console/env` — root-owned, chmod 600, **NOT in git**. Read by systemd.
- **Stack:** Postgres for data (`PG*` vars in env), S3 bucket `fwai-ivr-audio` for audio uploads (via attached IAM role `ivr-ec2-s3`, no keys needed)

## Standard deploy (code change already pushed to `main`)

SSH in, then run:

```bash
cd /opt/ivr-console
git fetch origin main && git reset --hard origin/main
npm ci
npm run build
sudo systemctl restart ivr-console
sleep 3
systemctl is-active ivr-console
journalctl -u ivr-console -n 20 --no-pager
```

Success = `systemctl is-active` prints `active` and the logs show `✓ Ready` with no
repeating errors. Then verify in a browser at the public URL.

**Why `git reset --hard origin/main`** (not `git pull`): the server must exactly match
the repo, and `pull` fails on divergent history (the repo has been force-pushed before).
`reset --hard` discards any local drift. This is safe **only because nobody hand-edits
code on the server** — the env file is separate and not in git, so it's untouched.

## Critical gotchas (learned the hard way)

1. **Restart alone does NOT pick up new code.** You MUST run `npm run build` after
   pulling. If you only `systemctl restart`, it reserves the OLD compiled `.next`. A
   restart without a rebuild was the #1 source of "I deployed but nothing changed."

2. **Build is memory-heavy on this t3.micro (1 GiB).** There's 2 GB swap so it works,
   but `npm run build` takes a few minutes and may look stalled at "Creating an
   optimized production build". If the build prints just `Killed`, it ran out of
   memory — confirm swap is on with `free -m`.

3. **Don't trust a grep for "upstash"/old strings in `.next` to judge the build.** Old
   library names can linger in comments inside compiled chunks. To verify what's live,
   check actual behavior or `grep` the **source** (`src/`), not `.next/`.

4. **Env changes** are made directly on the server (file is not in git):
   ```bash
   sudo nano /etc/ivr-console/env      # edit
   sudo systemctl restart ivr-console  # apply
   ```
   No quotes, no spaces around `=`. After editing, the service must be restarted (a
   rebuild is not needed for env-only changes). Note: the file is root-owned and 600,
   so a normal-user `grep`/`cat` gets "Permission denied" — use `sudo`. (This bit us:
   reading `SESSION_SECRET` without sudo silently produced an empty value.)

5. **Passwords with special chars** (`@`, `:`, `/`) break a `DATABASE_URL`. This app
   also supports separate `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSL` vars —
   prefer those when the password has symbols.

## If code is NOT yet pushed (writing a change first)

Code changes go through the GitHub repo, not direct edits on the server. The flow:
clone, edit, commit, push to `main`, THEN run the standard deploy above. Anyone
pushing needs write access (collaborator) on `kiranfwai/ivr-console`. Coordinate so two
people don't force-push over each other.

## Rollback

```bash
cd /opt/ivr-console
git reset --hard <previous-commit-sha>   # or origin/main~1
npm ci && npm run build
sudo systemctl restart ivr-console
```

## Quick health checks

```bash
systemctl is-active ivr-console                       # active?
curl -I http://127.0.0.1:3000                         # 200 or 307 = app alive
journalctl -u ivr-console -n 30 --no-pager            # recent logs / errors
systemctl show ivr-console -p ActiveEnterTimestamp    # when it last started (did the restart take?)
```

## Notes / open items for this deployment

- Deploys are manual by choice. If push-to-deploy is ever wanted, set up a GitHub
  Actions workflow that SSHes in and runs the standard deploy block.
- Postgres currently lives on an external (non-AWS) box; moving it to AWS RDS is the
  remaining step for a fully-on-AWS setup.
- Security follow-ups noted during setup: rotate any credentials that were shared in
  chat, use a dedicated limited DB user instead of a superuser, and lock the SSH
  security-group rule to known IPs rather than `0.0.0.0/0`.
