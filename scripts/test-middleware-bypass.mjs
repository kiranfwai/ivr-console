// Regression test for CVE-2025-29927 (Next.js middleware bypass via the
// `x-middleware-subrequest` header). All auth + tenant pinning lives in
// src/middleware.ts, so if this header can skip middleware, an unauthenticated
// caller reaches admin routes and can choose any tenant via `x-ivr-client`.
//
// Run against a PRODUCTION build (`npm run build && npx next start`):
//   node scripts/test-middleware-bypass.mjs [baseUrl]
// Every probe must be refused (401/403/307). Read-only: GETs only.

const BASE = process.argv[2] || "http://127.0.0.1:3000";

const VALUES = [
  "middleware",
  "src/middleware",
  "middleware:middleware:middleware:middleware:middleware",
  "src/middleware:src/middleware:src/middleware:src/middleware:src/middleware",
  "pages/_middleware",
];
const PATHS = ["/api/admin/clients", "/api/admin/calls", "/api/campaigns", "/api/dashboard"];

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`); }
}

// Sanity: without the header, protected routes must already refuse.
for (const p of PATHS) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  check(`no header ${p} refused`, [401, 403, 307].includes(r.status), `status ${r.status}`);
}

for (const v of VALUES) {
  for (const p of PATHS) {
    const r = await fetch(BASE + p, {
      redirect: "manual",
      headers: { "x-middleware-subrequest": v, "x-ivr-client": "cli_bypass_probe" },
    });
    check(`bypass "${v.slice(0, 32)}" ${p} refused`, [401, 403, 307].includes(r.status), `status ${r.status}`);
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
