/**
 * Proves the tab-switch flash is gone.
 *
 * The bug: every tab painted its empty state ("No campaigns yet", "No audios
 * yet", …) for the frame before its first request came back, so switching tabs
 * read as "there is nothing here" and then filled in.
 *
 * Catching a one-frame flash reliably is impossible by screenshot, so instead
 * this HOLDS the API request open (CDP Fetch interception) and inspects what
 * the screen says while it is pending. If the empty state is on screen at that
 * moment, the flash exists; if the loading state is, it does not.
 *
 * Usage (local sandbox DB running):
 *   1. npm run dev
 *   2. chrome --headless=new --remote-debugging-port=9231 --user-data-dir=<tmp> about:blank
 *   3. node scripts/test-loading-states.mjs
 *
 * The sandbox needs at least one sheet connection for the lead-queue case;
 * without one that case reports SKIP rather than a false pass.
 */
const APP = "http://localhost:3000";
const CDP_PORT = 9231;
const CLIENT = { email: "test@local", password: "testlocal" };

const CASES = [
  { tab: "campaigns", api: "/api/campaigns", loading: "Loading campaigns",           empty: "No campaigns yet" },
  { tab: "audios",    api: "/api/audios",    loading: "Loading your audio library",  empty: "No audios yet" },
  { tab: "dial",      api: "/api/campaigns", loading: "Loading campaigns",           empty: "No campaigns yet" },
  { tab: "bulk",      api: "/api/campaigns", loading: "Loading campaigns",           empty: "Create a campaign first" },
  { tab: "gsheets",   api: "/api/gsheets/leads", loading: "Loading the lead queue",  empty: "No leads yet", needs: "Lead Queue" },
];

let passed = 0, failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log("  PASS  " + label); }
  else { failed++; console.log("  FAIL  " + label + (detail ? "\n        " + detail : "")); }
}

// --- minimal CDP client -----------------------------------------------------
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const p = c.pending.get(msg.id);
        if (p) { c.pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
      } else {
        const h = c.handlers.get(msg.method);
        if (h) h(msg.params);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(method, fn) { this.handlers.set(method, fn); }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function text(cdp) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  return r.result?.value ?? "";
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("no page target — is headless Chrome running?");
  const cdp = await CDP.attach(page.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  // Sign in inside the page so the httpOnly cookie lands in the browser jar.
  await cdp.send("Page.navigate", { url: `${APP}/login` });
  await sleep(2500);
  const login = await cdp.send("Runtime.evaluate", {
    expression: `fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},
                 body:JSON.stringify(${JSON.stringify(CLIENT)})}).then(r=>r.status)`,
    awaitPromise: true, returnByValue: true,
  });
  check("signed in as the sandbox client", login.result?.value === 200, `status ${login.result?.value}`);

  for (const c of CASES) {
    // Hold this tab's API request open so the pending state is observable for
    // as long as we need, instead of for one frame.
    // A screen can fire the same endpoint from several components, so hold ALL
    // of them — releasing only the first left the rest paused and the screen
    // stuck on "loading", which looked like a product bug and was a test bug.
    const held = [];
    let releaseImmediately = false;
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*${c.api}*`, requestStage: "Request" }] });
    cdp.on("Fetch.requestPaused", (p) => {
      if (releaseImmediately) cdp.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      else held.push(p.requestId);
    });

    await cdp.send("Page.navigate", { url: `${APP}/?tab=${c.tab}` });

    // Wait until the request is actually paused (or give up).
    for (let i = 0; i < 60 && !held.length; i++) await sleep(100);
    // The held request stays held, so waiting here costs nothing and lets the
    // REST of the screen finish loading. Without it we sample before the panel
    // that contains the empty state has even rendered, and prove nothing.
    await sleep(1200);

    const during = await text(cdp);
    // The lead queue only renders once a sheet connection exists; with none in
    // the sandbox there is no panel to flash. Say so rather than score it.
    const applicable = !c.needs || during.includes(c.needs);
    if (!applicable) {
      console.log(`  SKIP  ${c.tab}: no ${c.needs} on this sandbox — panel not rendered`);
    } else {
      check(
        `${c.tab}: shows "${c.loading}…" while loading`,
        during.includes(c.loading),
        `screen said: ${JSON.stringify(during.slice(0, 160))}`,
      );
    }
    check(
      `${c.tab}: does NOT claim "${c.empty}" while loading`,
      !during.includes(c.empty),
      `screen said: ${JSON.stringify(during.slice(0, 120))}`,
    );

    // Let it through and confirm the screen resolves to a real answer.
    releaseImmediately = true;
    for (const id of held) await cdp.send("Fetch.continueRequest", { requestId: id }).catch(() => {});
    await sleep(1500);
    const after = await text(cdp);
    check(
      `${c.tab}: settles into real content once the response lands`,
      !after.includes(c.loading),
      `still loading: ${JSON.stringify(after.slice(0, 120))}`,
    );

    await cdp.send("Fetch.disable");
    cdp.handlers.delete("Fetch.requestPaused");
  }

  cdp.close();
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("harness error:", e); process.exit(2); });
