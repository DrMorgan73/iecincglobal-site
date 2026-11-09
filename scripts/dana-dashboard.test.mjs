/* Local test suite for api/dana-dashboard.js (IEC Office — Dana
   Follow-Up board). Runs the real handler against the in-memory
   Blob mock: session gate (401), seed-on-empty (16 buyers /
   3 decisions / 1 run from Dana's 2026-11-09 record), save + read
   back roundtrip, sanitizing (nameless buyers dropped, strings
   capped, unknown fields dropped), reset back to the seed, and the
   unconfigured-store answers. No real Blob writes.

   Run: node scripts/dana-dashboard.test.mjs   (exit 1 on failure) */

import crypto from "node:crypto";
import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";

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

const mod = await import("../api/dana-dashboard.js");
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

console.log("dana-dashboard.test");

/* --- session gate --- */
let r = await call("GET", undefined, null);
check("no cookie → 401", r.statusCode === 401 && r.payload.error === "unauthorized", r);
r = await call("GET", undefined, "desk_session=forged.9999999999.deadbeef");
check("forged cookie → 401", r.statusCode === 401, r);
r = await call("POST", { state: {} }, null);
check("POST without session → 401", r.statusCode === 401, r);

/* --- seed on empty --- */
r = await call("GET");
check("fresh GET → ok, configured, seeded", r.statusCode === 200 && r.payload.ok === true && r.payload.configured === true && r.payload.seeded === true, r);
check("seed has 16 buyers", r.payload.state.buyers.length === 16, r.payload.state.buyers.length);
check("seed has 3 decisions", r.payload.state.decisions.length === 3, r.payload.state.decisions.length);
check("seed has 1 run", r.payload.state.runs.length === 1, r.payload.state.runs.length);
check("seed run is Dana's 2026-11-09 run", r.payload.state.runs[0].date === "2026-11-09", r.payload.state.runs[0]);
check("seed decisions all open", r.payload.state.decisions.every(d => d.resolved === false), r.payload.state.decisions);
check("seed names micro1 + AstraZeneca + OneMedNet", ["micro1", "AstraZeneca", "OneMedNet"].every(n => r.payload.state.buyers.some(b => b.name === n)), r.payload.state.buyers.map(b => b.name));
check("AstraZeneca seed carries Proposal 8812", r.payload.state.buyers.find(b => b.name === "AstraZeneca").lastAction.includes("8812"));
check("seed never names a practice / states no fee split", !JSON.stringify(r.payload.state).match(/boston pain|25%|75%/i), null);

/* --- save + read back roundtrip --- */
const edited = JSON.parse(JSON.stringify(r.payload.state));
edited.decisions[0].resolved = true;
edited.decisions[0].resolvedAt = "2026-11-09";
edited.buyers.find(b => b.name === "OM1").nextStep = "Nudge approved by DrMorgan — send this week.";
edited.buyers.find(b => b.name === "OM1").note = "Test note";
edited.buyers.push({ id: "b-test-new", name: "Test Buyer", tier: "Tier 3", status: "Identified", lastAction: "", nextStep: "", note: "" });
edited.runs.push({ id: "r-test", date: "2026-11-11", summary: "Wednesday scout.", changes: "Nothing moved." });

r = await call("POST", { state: edited });
check("POST save → 200 ok", r.statusCode === 200 && r.payload.ok === true, r);
check("saved board has 17 buyers", r.payload.state.buyers.length === 17, r.payload.state.buyers.length);
check("saved board has 2 runs", r.payload.state.runs.length === 2, r.payload.state.runs.length);
check("updatedAt stamped", typeof r.payload.state.updatedAt === "string" && r.payload.state.updatedAt.length > 0, r.payload.state);

r = await call("GET");
check("GET after save → not seeded", r.statusCode === 200 && r.payload.seeded === false, r);
check("roundtrip: decision stayed resolved", r.payload.state.decisions[0].resolved === true && r.payload.state.decisions[0].resolvedAt === "2026-11-09", r.payload.state.decisions[0]);
check("roundtrip: OM1 follow-up persisted", r.payload.state.buyers.find(b => b.name === "OM1").note === "Test note", r.payload.state.buyers.find(b => b.name === "OM1"));
check("roundtrip: added buyer persisted", r.payload.state.buyers.some(b => b.name === "Test Buyer"), null);
check("roundtrip: added run persisted", r.payload.state.runs.some(x => x.id === "r-test"), null);

/* --- sanitizing --- */
r = await call("POST", { state: {
  decisions: [{ id: "d-x", title: "  Real decision  ", detail: "d", resolved: "yes", bogus: "drop me" }, { title: "   " }, "junk"],
  buyers: [{ name: "" }, { name: "  Keeper  ", tier: "", status: "s".repeat(500), evil: "<script>" }, null],
  runs: [{ summary: "", changes: "" }, { date: "2026-11-12", summary: "s", changes: "c" }]
} });
check("nameless buyers + empty decisions/runs dropped", r.payload.state.buyers.length === 1 && r.payload.state.decisions.length === 1 && r.payload.state.runs.length === 1, r.payload.state);
check("titles/names trimmed", r.payload.state.decisions[0].title === "Real decision" && r.payload.state.buyers[0].name === "Keeper", r.payload.state);
check("unknown fields dropped", !("bogus" in r.payload.state.decisions[0]) && !("evil" in r.payload.state.buyers[0]), r.payload.state);
check("resolved coerced to boolean", r.payload.state.decisions[0].resolved === false && r.payload.state.decisions[0].resolvedAt === null, r.payload.state.decisions[0]);
check("overlong status capped at 200", r.payload.state.buyers[0].status.length === 200, r.payload.state.buyers[0].status.length);
check("missing tier defaults to Tier 3", r.payload.state.buyers[0].tier === "Tier 3", r.payload.state.buyers[0]);

/* --- reset returns to the seed --- */
r = await call("POST", { action: "reset" });
check("reset → seed board", r.statusCode === 200 && r.payload.ok === true && r.payload.state.buyers.length === 16 && r.payload.state.decisions.length === 3, r);
r = await call("GET");
check("GET after reset → seeded again", r.statusCode === 200 && r.payload.seeded === true && r.payload.state.buyers.length === 16, r.payload);

/* --- method guard --- */
r = await call("DELETE", undefined);
check("DELETE → 405", r.statusCode === 405, r);

/* --- unconfigured store --- */
delete process.env.BLOB_READ_WRITE_TOKEN;
r = await call("GET");
check("GET unconfigured → ok, seed, configured false", r.statusCode === 200 && r.payload.ok === true && r.payload.configured === false && r.payload.state.buyers.length === 16, r);
r = await call("POST", { state: edited });
check("POST unconfigured → 503 not_configured", r.statusCode === 503 && r.payload.error === "not_configured", r);
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";

/* --- the seed itself, direct from internals --- */
check("SEED_STATE is 16 / 3 / 1", X.SEED_STATE.buyers.length === 16 && X.SEED_STATE.decisions.length === 3 && X.SEED_STATE.runs.length === 1, null);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll dana-dashboard tests passed.");
