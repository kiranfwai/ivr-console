/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * We use it to start the in-process bulk-call worker so campaigns are driven by
 * the backend (not the browser). Guarded to the Node.js runtime so it never runs
 * in the edge runtime or during the build.
 */
export async function register() {
  // Local-dev escape hatch: skip the DB-backed dial worker when there's no
  // database configured (set WORKER_DISABLED=1 in .env.local). Defaults to off,
  // so deployed behavior is unchanged.
  if (process.env.WORKER_DISABLED === "1") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/worker");
    await startWorker();
    const { startGsheetsPoller } = await import("./lib/gsheets");
    await startGsheetsPoller();
  }
}
