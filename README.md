# IVR Console v2

Outbound IVR + press-1 → WhatsApp control panel. Next.js 14 (App Router) on Vercel,
Plivo Calls, Pabbly webhook → WhatsApp, **Upstash Redis** for persistent state.

This is a full rewrite of the v1 console. Differences worth knowing about:

| | v1 | v2 |
|---|---|---|
| Event store | in-memory, lost on cold start | Upstash Redis, durable |
| Campaigns | hard-coded routes (`day1`, `beforeday`) | CRUD'd in-dashboard, dynamic answer URL `/api/answer/<id>` |
| Audio library | files in `/public/audios` only, requires redeploy to add | URL-paste + optional Vercel Blob upload, no redeploy |
| Bulk dialing | sync loop in one Vercel function (timeouts) | Redis-persisted job, browser-paced, survives tab close, "Resume" picks up |
| Press-1 webhook | `?w=<base64-of-any-url>` in answer URL — **open SSRF** | webhook keyed off the campaign, never accepts URLs from the query string |
| Plivo callback signing | unverified | optional V3 signature verification behind `VERIFY_PLIVO_SIG=1` |
| Auth cookie | the admin password verbatim | random session id signed with HMAC, password never in cookie |
| Dashboard | one 1,441-line file | 6 tab components, ~150–250 lines each |

---

## 1. One-time setup (Vercel + Upstash)

### Upstash Redis (free tier)
1. Sign up at <https://console.upstash.com>
2. Create a **Redis database** (Global, or any region close to your Vercel deploy).
3. From the database page, copy the **REST URL** and **REST Token**. These map to:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### Vercel Blob (optional, only if you want in-dashboard audio uploads)
1. Vercel dashboard → Storage → Create → Blob.
2. Connect it to your project. Vercel injects `BLOB_READ_WRITE_TOKEN` automatically.
3. If you skip this, the **Audios** tab still works via "Paste URL" — host MP3s anywhere public.

### Generate a session secret
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the output into `SESSION_SECRET`.

---

## 2. Environment variables

Set these on Vercel → Project → Settings → Environment Variables, or locally in `.env.local`.

| Key | Required | Notes |
|---|---|---|
| `PLIVO_AUTH_ID` | ✅ | Plivo account ID |
| `PLIVO_AUTH_TOKEN` | ✅ | Plivo auth token (encrypted) |
| `PLIVO_FROM_NUMBER` | ✅ | Default Plivo caller ID, e.g. `+918031340818` |
| `SESSION_SECRET` | ✅ | 32-byte hex (see above) |
| `ADMIN_PASSWORD` | ✅ | Login password |
| `UPSTASH_REDIS_REST_URL` | ✅ | From Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | From Upstash console |
| `PABBLY_WEBHOOK_URL` | ⭕ | Default press-1 webhook (used when a campaign doesn't override) |
| `PABBLY_WEBHOOK_URL_CALL` | ⭕ | Alt webhook for the WhatsApp tab's "call-shaped payload" |
| `PUBLIC_BASE_URL` | ⭕ | Self URL; leave blank on Vercel (auto from `VERCEL_URL`) |
| `BLOB_READ_WRITE_TOKEN` | ⭕ | Enables audio file uploads. Auto-set when Vercel Blob is linked. |
| `VERIFY_PLIVO_SIG` | ⭕ | Set to `1` to require valid Plivo signature on every webhook. **Leave unset on first deploy**, flip on after smoke-testing. |

---

## 3. Local dev

```powershell
cd ivr-console-v2
npm install
copy .env.local.example .env.local
# edit .env.local with real values
npm run dev
# http://localhost:3000
```

Plivo can't reach `localhost`, so for end-to-end testing use a tunnel (`ngrok http 3000` or `cloudflared tunnel`).
Set `PUBLIC_BASE_URL=https://your-tunnel.example` in `.env.local` so the answer/hangup URLs handed to Plivo are reachable.

---

## 4. Deploy

```powershell
cd ivr-console-v2
npx vercel --prod
```

Or push to a GitHub repo linked to a Vercel project — same effect.

---

## 5. Day-to-day usage

### First time
1. **Sign in** with `ADMIN_PASSWORD`.
2. **Audios** tab → add at least one audio (paste a public MP3 URL, e.g. `https://your-site.com/day1.mp3`,
   or upload a file if you've set up Vercel Blob).
3. **Campaigns** tab → New campaign:
   - Name (e.g. "Day-1 outreach")
   - Audio (pick from library)
   - Press-1 webhook URL (paste your Pabbly Workflow A webhook, or leave blank to use `PABBLY_WEBHOOK_URL`)
   - From number (leave blank to use `PLIVO_FROM_NUMBER`)
   - Prompt: the line spoken after the audio plays.

### Single call
**Dial** tab → pick campaign → type phone → **Place call**. Indian 10-digit numbers auto-prefix `+91`; full E.164 (`+14155551234`) also works.

### Bulk dial
**Bulk** tab → pick campaign → paste numbers (one per line, optional `,name`):
```
9876543210,Animesh
9123456789,Test
+14155551234
```
Set delay (default 2s) → **Start**. Browser paces the dialing; if you close the tab, the job pauses — re-open and click **Resume**. Failed rows are listed for retry.

### Reports
**Reports** tab → pick day (today/yesterday/date picker) and optionally a campaign → see KPIs, by-hour bar chart, per-campaign breakdown, and Plivo hangup causes. Hit **Refresh** to repoll.

### Direct WhatsApp send (no call)
**WhatsApp** tab → fire `PABBLY_WEBHOOK_URL` directly with `{ phone, name, ...extra }`. Useful for testing the Pabbly side, or for trickle sends without an IVR.

---

## 6. Architecture (at a glance)

```
Browser ──HTTPS──┬─► /api/auth/login         (HMAC session cookie)
                 ├─► /api/call               (place 1 call via Plivo)
                 ├─► /api/bulk               (queue/inspect bulk jobs)
                 ├─► /api/campaigns          (CRUD)
                 ├─► /api/audios             (library)
                 ├─► /api/reports            (KPIs from Redis + Plivo)
                 └─► /api/whatsapp/send      (direct Pabbly fire)

Plivo ──HTTPS──► /api/answer/<campaignId>?req=<id>   → returns IVR XML
       ──HTTPS──► /api/dtmf?req=<id>                  → handles press-1, hits campaign's webhook
       ──HTTPS──► /api/hangup?req=<id>                → records duration + cause

Storage: Upstash Redis (campaigns, audios, calls, bulk jobs, session aliases)
```

### Call lifecycle
1. `POST /api/call { phone, campaignId }` → looks up campaign → Plivo `Calls API`.
2. Plivo returns `request_uuid`. We persist a `CallRecord` keyed by it (`status: queued`).
3. Plivo dials the recipient. On answer, Plivo POSTs `/api/answer/<campaignId>?req=<uuid>`.
   - We return XML: `<GetDigits><Play>campaign.audio.url</Play><Speak>campaign.prompt</Speak></GetDigits>`.
   - We update the record to `status: answered` and alias Plivo's `CallUUID` → our id.
4. On DTMF, Plivo POSTs `/api/dtmf?req=<uuid>` with `Digits`. If `Digits === "1"`, we POST the **campaign's** webhook (never a URL from the query string), update `status: press1, pabblyStatus: <code>`, and return a goodbye XML.
5. On hangup, Plivo POSTs `/api/hangup?req=<uuid>` with `CallStatus`, `Duration`, `HangupCause`. We finalize the record.

### Why this closes the v1 SSRF
v1's `/api/answer` accepted a base64-encoded webhook URL in `?w=…` and `/api/dtmf` POSTed to it. v2 never reads URLs from `/api/dtmf`'s query string — the webhook is read from `call.webhookUrl` (set at place-call time from the campaign, then immutable). The only query param is `req` (an opaque id we minted), and even if Plivo signature verification is off, an attacker who guesses `req` can at worst toggle the status of one of *your* calls — they cannot make your server POST anywhere.

---

## 7. Migrating from v1

Old v1 routes that **no longer exist** (and what to use instead):

| v1 route | v2 equivalent |
|---|---|
| `GET/POST /api/answer/day1` | `POST /api/answer/<campaignId>` (campaign named "Day-1") |
| `GET/POST /api/answer/beforeday` | `POST /api/answer/<campaignId>` (campaign named "Before-day") |
| `GET/POST /api/answer/custom?audio=…&prompt=…&w=…` | Just create a campaign — no per-call audio URLs |
| `POST /api/call { audio:"day1", webhookUrl:"…" }` | `POST /api/call { campaignId, phone }` |
| `POST /api/bulk { rows:[…] }` | `POST /api/bulk { campaignId, rows, delayMs }` |
| `GET /api/calls` | `GET /api/reports` (richer) |
| `POST /api/pabbly-test` | **WhatsApp** tab, or `POST /api/whatsapp/send` |

If Plivo still has old answer URLs configured (`…/api/answer/day1`), point them at one of the new
campaign answer URLs (`…/api/answer/<id>`). The old route paths are gone in v2.

If you want the new Plivo answer URL right now without a Plivo dashboard change, you can keep a campaign id stable by creating it once and reusing it across deploys — the id is shown in the URL bar when you open the campaign editor (or in the "from" answer URL printed by `/api/call`'s response).

---

## 8. Troubleshooting

**"Upstash Redis not configured"** — set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. The dashboard won't load without them.

**Login loop** — `SESSION_SECRET` not set or changed between requests. Set it once, redeploy.

**Plivo 401** — `PLIVO_AUTH_TOKEN` wrong. Rotate in Plivo dashboard → update env → redeploy.

**Call rings but no audio** — answer URL unreachable. Confirm `https://<your-domain>/api/answer/<campaignId>?req=test` returns XML (will say "Campaign not found" without a real id, but it should still be XML, not HTML or 401).

**Press-1 didn't fire WhatsApp** —
1. Open the **Reports** tab, find the call. `status` should be `press1` and `pabblyStatus` should be `200`.
2. If `pabblyStatus` is `0` or `-1`, the campaign's `webhookUrl` is blank and `PABBLY_WEBHOOK_URL` is unset.
3. If `200` but no WhatsApp arrived, the Pabbly workflow is OFF or the WhatsApp template isn't approved.

**Bulk job hangs** — the browser drives it. If you close the tab, status stays in Redis; reopen Bulk, click the job, hit **Resume**.

**`/api/answer` returns 401** — `VERIFY_PLIVO_SIG=1` is on but the signature didn't match. Likely cause: `PUBLIC_BASE_URL` doesn't match the host Plivo is hitting (signature is over the exact URL). Either align them or temporarily unset `VERIFY_PLIVO_SIG`.

---

## 9. Tech notes

- All HMAC done with Web Crypto (works in both Node and Edge runtimes).
- Redis access goes through `@upstash/redis`'s REST client — works in serverless without connection pooling.
- `/api/answer`, `/api/dtmf`, `/api/hangup` declared `runtime = "nodejs"` (need `req.text()` for raw body to verify Plivo signature; edge would also work but Node is fine here).
- All other routes are default Node runtime (App Router).
- No build step beyond `next build`. No tests yet — open question for v2.1.

### Reports at scale (counters)

Report KPIs/breakdowns are served from **rolled-up counter hashes in Redis**
(`stats:d:<istday>` and `stats:dc:<istday>:<campaignId>`), incremented as each call
progresses (placed → answered → press-1 → finalized). Reads are O(days-in-range),
independent of call volume — this is what lets the dashboard stay correct past the
old ~1000-record ceiling at 20k calls/day. Day buckets are **IST (Asia/Kolkata)**,
so "Today" matches the local wall clock, not UTC midnight.

**Run the backfill once after deploying this version** to populate counters from
existing call records (otherwise pre-existing days read as zero):

```
GET (or POST) /api/reports/backfill?from=2026-05-01&to=2026-06-08   # while logged in
```

It defaults to the last 31 days. It's idempotent (overwrites each day with absolute
totals), so it doubles as a resync if numbers ever look off. For very large
histories, backfill a few days at a time to stay within the function time limit.

### Security defaults to flip on

- **Turn on `VERIFY_PLIVO_SIG=1`** once end-to-end is confirmed. The webhook routes
  (`/api/answer`, `/api/dtmf`, `/api/hangup`) are publicly reachable by design;
  without the signature they rely only on a guess-resistant `req` id. `/api/dtmf`
  no longer fires the Pabbly webhook unless it matches a call **we** actually placed
  (and only to that call's stored number), but signature verification is the real lock.
- `ADMIN_PASSWORD` and `SESSION_SECRET` are now **required in production** — the app
  fails closed (no hardcoded `ivr2026` / dev-secret fallback) if either is unset.
