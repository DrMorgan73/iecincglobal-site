/* Local test suite for api/questionnaire-submissions.js +
   api/_questionnaire-db.js listSubmissions.

   fetch is mocked for the Neon HTTPS SQL endpoint (host derived
   from the test connection URI). No real database. The Desk
   session cookie is minted with a TEST-ONLY secret, locally —
   the same pattern as scripts/data-assets.test.mjs.

   Run: node scripts/questionnaire-submissions.test.mjs   (exit 1 on failure) */

import crypto from "node:crypto";

/* ---------------- env ---------------- */
const SECRET = "test-only-secret-questionnaire-submissions";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.QUESTIONNAIRE_DATABASE_URL =
  "postgres://user:pass@mock-neon.test/neondb?sslmode=require";

/* ---------------- mocked Neon SQL endpoint ---------------- */
const ROWS = [
  {
    reference: "mwtest02-bbbb2222",
    segment: "nonprofit",
    contact: { name: "TEST Person Two", business: "TEST School", email: "t@example.com", phone: "" },
    submitted_at: "2026-11-12T01:11:02.011Z"
  },
  {
    reference: "mwtest01-aaaa1111",
    segment: "pharmacy",
    contact: { name: "TEST Person One", business: "TEST Pharmacy", email: "t@example.com", phone: "" },
    submitted_at: "2026-11-11T20:00:00.000Z"
  }
];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://mock-neon.test/sql")) {
    const body = JSON.parse(opts.body || "{}");
    if (/ORDER BY submitted_at DESC/.test(body.query)) {
      const limit = Number(body.params && body.params[0]) || 100;
      return new Response(JSON.stringify({ rows: ROWS.slice(0, limit), rowCount: Math.min(ROWS.length, limit) }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }
    throw new Error(`unmocked SQL: ${String(body.query).slice(0, 60)}`);
  }
  return realFetch(url, opts);
};

/* ---------------- handler under test ---------------- */
const { default: handler } = await import("../api/questionnaire-submissions.js");

function mockRes() {
  return {
    statusCode: 0, payload: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { try { this.payload = JSON.parse(s); } catch (e) { this.payload = s; } }
  };
}
function mockReq(method, cookie, url) {
  return { method, url: url || "/api/questionnaire-submissions", headers: cookie ? { cookie } : {} };
}
function sessionCookie(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok — ${name}`); }
  else { failed++; console.log(`  FAIL — ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); }
}

/* ---------------- cases ---------------- */
let r = mockRes();
await handler(mockReq("GET", null), r);
check("no session → 401", r.statusCode === 401, r.payload);

r = mockRes();
await handler(mockReq("GET", "desk_session=forged.9999999999.deadbeef"), r);
check("forged session → 401", r.statusCode === 401, r.payload);

r = mockRes();
await handler(mockReq("POST", sessionCookie("audittest")), r);
check("POST → 405", r.statusCode === 405, r.payload);

r = mockRes();
await handler(mockReq("GET", sessionCookie("audittest")), r);
check("valid session → 200", r.statusCode === 200 && r.payload && r.payload.ok === true, r.payload);
check("two submissions returned", r.payload && Array.isArray(r.payload.submissions) && r.payload.submissions.length === 2, r.payload);
const first = r.payload && r.payload.submissions && r.payload.submissions[0];
check("newest first + segment label mapped",
  !!first && first.id === "mwtest02-bbbb2222" && first.segment === "nonprofit" && first.segmentLabel === "Nonprofit — School / Mosque", first);
check("business + name surfaced from contact",
  !!first && first.business === "TEST School" && first.name === "TEST Person Two", first);
check("receivedAt is ISO", !!first && first.receivedAt === "2026-11-12T01:11:02.011Z", first);
check("answers are NOT exposed", !!first && !("answers" in first), first);

delete process.env.QUESTIONNAIRE_DATABASE_URL;
r = mockRes();
await handler(mockReq("GET", sessionCookie("audittest")), r);
check("DB not configured → 503 (honest, never faked)", r.statusCode === 503, r.payload);
process.env.QUESTIONNAIRE_DATABASE_URL =
  "postgres://user:pass@mock-neon.test/neondb?sslmode=require";

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
