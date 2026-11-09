/* Local test suite for api/opportunities.js (IEC Office — Dana
   Opportunities, made live 2026-11-09 on DrMorgan's order: the page
   "needs to be live and search opportunities"). Runs the real handler
   against the in-memory Blob mock: session gate (401), empty-on-first-
   load (the pipeline is genuinely empty — nothing is seeded), save +
   read back roundtrip, sanitizing (nameless entries dropped, strings
   capped, verdicts/types/sides restricted, values normalized, unknown
   fields dropped, duplicate ids collapsed), the bare-array body, the
   unconfigured-store answers, plus the page wiring: the search
   predicate extracted from the shipped desk/opportunities.html and
   run against fixtures, the one-time browser migration, and the live
   subtitle. No real Blob writes.

   Run: node scripts/opportunities.test.mjs   (exit 1 on failure) */

import crypto from "node:crypto";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "test-blob" + "-token";

const textRes = (status, text) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new Error("not json"); },
  text: async () => text
});

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://blob.mock/")) {
    for (const rec of blobMock.__blobs.values()) {
      if (rec.url === u) return textRes(200, rec.content);
    }
    return textRes(404, "");
  }
  throw new Error(`unmocked fetch: ${u}`);
};

const mod = await import("../api/opportunities.js");
const handler = mod.default;
const X = mod._internals;

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}

async function call(method, body, cookie) {
  const req = {
    method,
    headers: cookie === null ? {} : { cookie: cookie ?? sessionCookie() },
    body
  };
  const res = {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader() {},
    end(s) { this.payload = JSON.parse(s); }
  };
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`); }
}

console.log("opportunities.test");

/* --- session gate --- */
let r = await call("GET", undefined, null);
check("no cookie → 401", r.statusCode === 401 && r.payload.error === "unauthorized", r);
r = await call("GET", undefined, "desk_session=forged.9999999999.deadbeef");
check("forged cookie → 401", r.statusCode === 401, r);
r = await call("POST", { opportunities: [] }, null);
check("POST without session → 401", r.statusCode === 401, r);

/* --- empty on first load (nothing is seeded — the pipeline is real) --- */
r = await call("GET");
check("fresh GET → 200 ok, configured", r.statusCode === 200 && r.payload.ok === true && r.payload.configured === true, r);
check("fresh GET → empty pipeline", Array.isArray(r.payload.opportunities) && r.payload.opportunities.length === 0, r.payload);

/* --- save + read back roundtrip --- */
const two = [
  { id: "o-beacon", name: "Beacon St brownstone", type: "Residential", side: "Sell", value: 750000, source: "LinkedIn", contact: "Sam · sam@example.com", verdict: "solid", notes: "The math works.", added: "Nov 9" },
  { id: "o-warehouse", name: "Dorchester warehouse", type: "Commercial", side: "Buy", value: "", source: "Referral", contact: "", verdict: "unscored", notes: "", added: "Nov 9" }
];
r = await call("POST", { opportunities: two });
check("POST save → 200 ok", r.statusCode === 200 && r.payload.ok === true, r);
check("saved array has both entries", r.payload.opportunities.length === 2, r.payload.opportunities);
check("numeric value kept as number", r.payload.opportunities[0].value === 750000, r.payload.opportunities[0]);

r = await call("GET");
check("roundtrip: both entries persisted", r.payload.opportunities.length === 2 && r.payload.opportunities[0].name === "Beacon St brownstone", r.payload.opportunities);
check("roundtrip: verdict persisted", r.payload.opportunities[0].verdict === "solid", r.payload.opportunities[0]);

/* --- bare array body is accepted --- */
r = await call("POST", two);
check("bare array POST → 200 with both entries", r.statusCode === 200 && r.payload.opportunities.length === 2, r);

/* --- sanitizing --- */
r = await call("POST", { opportunities: [
  { name: "   " },
  { id: "o-keep", name: "  Keeper  ", type: "Castle", side: "Rent", verdict: "great", value: "$1,250,000", notes: "n".repeat(900), evil: "<script>" },
  { id: "o-keep", name: "Duplicate id" },
  "junk",
  null,
  { id: "bad id!", name: "Fresh id" }
] });
check("nameless + junk dropped, duplicate ids collapsed", r.payload.opportunities.length === 2, r.payload.opportunities);
const keeper = r.payload.opportunities.find(o => o.name === "Keeper");
check("name trimmed", !!keeper, r.payload.opportunities);
check("unknown type/side default to the form's first options", keeper.type === "Residential" && keeper.side === "Sell", keeper);
check("unknown verdict coerced to unscored", keeper.verdict === "unscored", keeper);
check("currency string value normalized to a number", keeper.value === 1250000, keeper);
check("overlong notes capped at 500", keeper.notes.length === 500, keeper.notes.length);
check("unknown fields dropped", !("evil" in keeper), keeper);
check("invalid id replaced with a valid one", r.payload.opportunities.every(o => /^[A-Za-z0-9_-]{1,64}$/.test(o.id)), r.payload.opportunities);

/* internals, direct */
check("sanitizeOpportunities(non-array) → []", X.sanitizeOpportunities("nope").length === 0 && X.sanitizeOpportunities(null).length === 0, null);
check("verdict set is exactly the page's four", JSON.stringify(X.VERDICTS) === JSON.stringify(["solid", "couldbe", "pass", "unscored"]), X.VERDICTS);

/* --- method guard --- */
r = await call("DELETE", undefined);
check("DELETE → 405", r.statusCode === 405, r);

/* --- unconfigured store --- */
delete process.env.BLOB_READ_WRITE_TOKEN;
r = await call("GET");
check("GET unconfigured → ok, configured false, empty", r.statusCode === 200 && r.payload.ok === true && r.payload.configured === false && r.payload.opportunities.length === 0, r);
r = await call("POST", { opportunities: two });
check("POST unconfigured → 503 not_configured", r.statusCode === 503 && r.payload.error === "not_configured", r);
process.env.BLOB_READ_WRITE_TOKEN = "test-blob" + "-token";

/* --- page wiring (static checks on the shipped page) --- */
const page = readFileSync(new URL("../desk/opportunities.html", import.meta.url), "utf8");
check("page loads from the live API", page.includes("fetch('/api/opportunities')") || page.includes('fetch("/api/opportunities")'), null);
check("page posts saves to the live API", page.includes("method: 'POST'") && page.includes("opportunities"), null);
check("subtitle is the live one", page.includes("Live — saved in your IEC Suite, on every device."), null);
check("old browser-only subtitle is gone", !page.includes("Saved privately in this browser."), null);
check("search box present above the pipeline", page.includes('id="opp-search"'), null);
check("result count element present", page.includes('id="opp-count"'), null);
check("one-time migration wired (flag + import message)", page.includes("morgan-desk-opportunities-migrated") && page.includes("Imported "), null);
check("unconfigured store surfaces an error, never a fake save", page.includes("not_configured") || page.includes("isn't configured") || page.includes("not configured"), null);

/* --- the search predicate itself, extracted from the shipped page --- */
const start = page.indexOf("/* ---- search (tested by scripts/opportunities.test.mjs) ---- */");
const endMark = "/* ---- end search ---- */";
const end = page.indexOf(endMark);
check("search block markers present in the page", start >= 0 && end > start, null);
if (start >= 0 && end > start) {
  const src = page.slice(start, end + endMark.length);
  const { OPP_SEARCH_FIELDS, oppMatches } = new Function(`${src}\nreturn { OPP_SEARCH_FIELDS, oppMatches };`)();
  check("search covers name/type/side/contact/source/notes", JSON.stringify(OPP_SEARCH_FIELDS) === JSON.stringify(["name", "type", "side", "contact", "source", "notes"]), OPP_SEARCH_FIELDS);
  const fix = { name: "Beacon St Brownstone", type: "Residential", side: "Sell", contact: "Sam · sam@example.com", source: "LinkedIn", notes: "The math works." };
  check("empty query matches everything", oppMatches(fix, "") === true && oppMatches(fix, "   ") === true, null);
  check("matches name, case-insensitive", oppMatches(fix, "beacon") === true && oppMatches(fix, "BROWNSTONE") === true, null);
  check("matches type and side", oppMatches(fix, "residential") === true && oppMatches(fix, "sell") === true, null);
  check("matches contact, source and notes", oppMatches(fix, "sam@example") === true && oppMatches(fix, "linkedin") === true && oppMatches(fix, "math works") === true, null);
  check("non-matching query excludes", oppMatches(fix, "warehouse") === false && oppMatches(fix, "zzz") === false, null);
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll opportunities tests passed.");
