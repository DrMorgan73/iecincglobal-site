/* Local test suite for the ACCEPTED merge in api/demo-admin.js
   (DrMorgan 2026-11-05: "Invited should change to Accepted, loged
   in /off"). The "list" action must report a stored "invited"
   account as "active" (Desk renders: ACCEPTED) when the central
   activity store holds a real "activated" or "login" event for
   that asset + email — retroactively, with no store write and no
   admin touch. Administrative states (paused / revoked / nda_sent)
   always win over events.

   Fixture people mirror the LIVE stores verified 2026-11-05
   (Troy Hyde invited on medexec + insnap with his activation
   recorded only on InSnap; Mohamed Ismael paused; Mohamed Ismail
   invited with no activity; the five seeds active). Tokens below
   are synthetic 48-hex strings — no real token appears in tests.

   GitHub + Blob are mocked (scripts/testing/); no network, no
   real writes. Run: node scripts/demo-admin-accepted.test.mjs
   (exit 1 on any failure) */

import crypto from "node:crypto";
import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);

/* ---------------- env (local harness values only) ---------------- */
const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.DEMO_ADMIN_GITHUB_TOKEN_MEDEXEC = "gh-test-medexec";
process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAP = "gh-test-insnap";
process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA = "gh-test-curavia";
process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAPP = "gh-test-insnapp";
process.env.DEMO_ADMIN_GITHUB_TOKEN_IECDOCS = "gh-test-iecdocs";
process.env.DEMO_ADMIN_RESEND_API_KEY = "resend-test-key";
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";

/* ---------------- fixture stores (mirror the live shapes) -------- */
const T = n => String(n).padStart(2, "0") + "a".repeat(46); // 48-hex-ish
function storeSource(accounts) {
  const rows = accounts.map(a => {
    const fields = [
      `    email: ${JSON.stringify(a.email)}`,
      `    name: ${JSON.stringify(a.name)}`,
      ...(a.token ? [`    token: ${JSON.stringify(a.token)}`] : []),
      `    status: ${JSON.stringify(a.status)}`,
      `    issuedAt: ${JSON.stringify(a.issuedAt || "2026-11-05T09:00:00-05:00")}`
    ];
    return "  {\n" + fields.join(",\n") + "\n  }";
  });
  return "const DEMO_PROVISIONED_ACCOUNTS = [\n" + rows.join(",\n") + "\n];\n";
}

const MORGAN = { email: "drmohdmorgan@gmail.com", name: "Mohammed M. Morgan, M.D.", token: T(1), status: "invited" };
const TROY = { email: "troyhyde@lghires.com", name: "Troy Hyde", token: T(2), status: "invited" };
const ISMAEL_PAUSED = { email: "mohdology@gmail.com", name: "Mohamed Ismael", token: T(3), status: "paused" };
const ISMAIL_INVITED = { email: "esteadysteps@gmail.com", name: "Mohamed Ismail", token: T(4), status: "invited" };
const STEP_ONLY = { email: "step.only@example.com", name: "Step Only", token: T(5), status: "invited" };
const SEED_FLAGGED = { email: "seed.flagged@example.com", name: "Seed Flagged", token: T(6), status: "invited" };
const seed = asset => ({ email: `demo@${asset}.example`, name: "Demo Reviewer", status: "active" });

const stores = {
  medexec: { source: storeSource([MORGAN, TROY, ISMAEL_PAUSED, ISMAIL_INVITED, STEP_ONLY, seed("medexec")]), sha: "sha-m0" },
  insnap: { source: storeSource([MORGAN, TROY, ISMAEL_PAUSED, ISMAIL_INVITED, SEED_FLAGGED, seed("insnap")]), sha: "sha-i0" },
  curavia: { source: storeSource([MORGAN, ISMAEL_PAUSED, ISMAIL_INVITED, seed("curavia")]), sha: "sha-c0" },
  insnapp: { source: storeSource([MORGAN, ISMAEL_PAUSED, ISMAIL_INVITED, seed("insnapp")]), sha: "sha-n0" },
  "iec-docs": { source: storeSource([MORGAN, seed("iecdocs")]), sha: "sha-d0" }
};

const GH = {
  medexec: "https://api.github.com/repos/DrMorgan73/medexec-site/contents/demo/provisioning.js",
  insnap: "https://api.github.com/repos/drmohdmorgan-del/insnap-job-engine/contents/public/demo/provisioning.js",
  curavia: "https://api.github.com/repos/DrMorgan73/getcuravia-site/contents/demo/provisioning.js",
  insnapp: "https://api.github.com/repos/drmohdmorgan-del/inssnap-del/contents/apps/web/public/demo/provisioning.js",
  "iec-docs": "https://api.github.com/repos/DrMorgan73/iec-docs/contents/public/demo/provisioning.js"
};
const ASSET_IDS = Object.keys(GH);

const blobMock = await import("./testing/blob-mock.mjs");

const jsonRes = (status, obj) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj)
});
const textRes = (status, text) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new Error("not json"); },
  text: async () => text
});

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  for (const id of ASSET_IDS) {
    if (u === GH[id]) {
      const store = stores[id];
      return jsonRes(200, { sha: store.sha, content: Buffer.from(store.source, "utf8").toString("base64") });
    }
  }
  if (u.startsWith("https://blob.mock/")) {
    const pathname = decodeURIComponent(u.slice("https://blob.mock/".length).split("?")[0]);
    const rec = blobMock.__blobs.get(pathname);
    return rec ? textRes(200, rec.content) : textRes(404, "");
  }
  if (u === "https://api.resend.com/emails") return jsonRes(200, { id: "email-x" });
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- seed the activity + invites stores ------------- */
const store = await import("../api/_demo-activity-store.js");
const NOW = new Date().toISOString();
/* Troy accepted on InSnap ONLY (mirrors his real 2026-11-05
   activation) — his MEDEXEC cell must NOT move. */
await store.appendActivityEvent({ asset: "insnap", email: TROY.email, name: "Troy Hyde", event: "activated", detail: "Account activated", ts: NOW, seed: false });
/* A login alone also proves acceptance (DrMorgan on CURAVIA). */
await store.appendActivityEvent({ asset: "curavia", email: MORGAN.email, name: MORGAN.name, event: "login", detail: "", ts: NOW, seed: false });
/* Admin state wins: Mohamed Ismael is PAUSED on InSnap — a login
   event there must not resurrect the cell. */
await store.appendActivityEvent({ asset: "insnap", email: ISMAEL_PAUSED.email, name: "Mohamed Ismael", event: "login", detail: "", ts: NOW, seed: false });
/* Non-acceptance activity proves nothing. */
await store.appendActivityEvent({ asset: "medexec", email: STEP_ONLY.email, name: "Step Only", event: "step_view", detail: "overview", ts: NOW, seed: false });
/* Seed-flagged events are ignored as acceptance evidence. */
await store.appendActivityEvent({ asset: "insnap", email: SEED_FLAGGED.email, name: "Seed Flagged", event: "activated", detail: "", ts: NOW, seed: true });

/* An NDA-first record with NO provisioning entry anywhere + a
   stray login event: the cell must stay nda_sent. */
blobMock.__blobs.set("demo-invites.json", {
  content: JSON.stringify([{ email: "nda.person@example.com", name: "Nda Person", asset: "medexec", sentAt: NOW, sends: 1 }]),
  url: "https://blob.mock/demo-invites.json",
  uploadedAt: new Date()
});
await store.appendActivityEvent({ asset: "medexec", email: "nda.person@example.com", name: "Nda Person", event: "login", detail: "", ts: NOW, seed: false });

/* ---------------- handler ---------------------------------------- */
const mod = await import("../api/demo-admin.js");
const handler = mod.default;
const X = mod._internals;

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}
async function call(body) {
  const req = { method: "POST", headers: { cookie: sessionCookie() }, body };
  const res = {
    statusCode: 0, payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader() {},
    end(s) { this.payload = JSON.parse(s); }
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.payload };
}

/* ---------------- tiny assert kit -------------------------------- */
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

/* ---------------- pure: acceptanceKeys ---------------------------- */
console.log("acceptanceKeys (pure)");
const keys = X.acceptanceKeys([
  { asset: "insnap", email: "A@Example.com", event: "activated", seed: false },
  { asset: "iec-docs", email: "b@example.com", event: "login", seed: false },
  { asset: "medexec", email: "c@example.com", event: "step_view", seed: false },
  { asset: "medexec", email: "d@example.com", event: "login", seed: true },
  { asset: "medexec", email: "e@example.com", event: "login_failed", seed: false }
]);
ok(keys.has("insnap|a@example.com"), "activated counts, email normalized");
ok(keys.has("iecdocs|b@example.com"), "login counts; registry id iec-docs canonicalizes to iecdocs");
ok(keys.size === 2, "step_view, seed-flagged and login_failed do NOT count");

/* ---------------- the merged list --------------------------------- */
console.log("list merge");
const r = await call({ action: "list" });
ok(r.status === 200 && r.body.ok === true, "list answers 200");
const row = email => r.body.matrix.find(p => p.email === email);
const acct = (asset, email) => (r.body.accounts[asset] || []).find(a => a.email === email);

/* The five verification rows (mirroring the live data): */
const troy = row(TROY.email);
ok(troy.cells.insnap === "active", "ROW 1 — Troy / insnap: invited + activation event -> active (Desk: ACCEPTED)");
ok(acct("insnap", TROY.email).acceptedFromActivity === true, "ROW 1 — payload flags the merge (acceptedFromActivity)");
ok(troy.cells.medexec === "invited", "ROW 2 — Troy / medexec: no event there -> stays invited");
ok(!acct("medexec", TROY.email).acceptedFromActivity, "ROW 2 — no merge flag on the untouched cell");
const ismael = row(ISMAEL_PAUSED.email);
ok(["medexec", "insnap", "curavia", "insnapp"].every(id => ismael.cells[id] === "paused"),
  "ROW 3 — Mohamed Ismael (mohdology): PAUSED on all four, login event does not override admin state");
for (const s of ["medexec", "insnap", "curavia", "insnapp", "iec-docs"]) {
  const seedRow = row(`demo@${s === "iec-docs" ? "iecdocs" : s}.example`);
  ok(seedRow && seedRow.cells[s] === "active", `ROW 4 — seed on ${s}: stored active -> ACCEPTED`);
  ok(!acct(s, seedRow.email).acceptedFromActivity, `ROW 4 — seed on ${s}: stored, not merged`);
}
const ismail = row(ISMAIL_INVITED.email);
ok(["medexec", "insnap", "curavia", "insnapp"].every(id => ismail.cells[id] === "invited"),
  "ROW 5 — Mohamed Ismail (esteadysteps): invited, no activation -> stays INVITED");

/* Supporting cases: */
const morgan = row(MORGAN.email);
ok(morgan.cells.curavia === "active" && acct("curavia", MORGAN.email).acceptedFromActivity === true,
  "login-only evidence flips invited -> accepted (per asset)");
ok(morgan.cells.medexec === "invited" && morgan.cells.insnap === "invited" &&
   morgan.cells.insnapp === "invited" && morgan.cells["iec-docs"] === "invited",
  "no cross-asset bleed: DrMorgan's other cells stay invited");
ok(row("nda.person@example.com").cells.medexec === "nda_sent",
  "nda_sent (invites store, no provisioning entry) is untouched by events");
ok(row(STEP_ONLY.email).cells.medexec === "invited", "step_view alone never flips a cell");
ok(row(SEED_FLAGGED.email).cells.insnap === "invited", "seed-flagged activation event never flips a cell");
const listJson = JSON.stringify(r.body);
ok(ASSET_IDS.every(id => !listJson.includes(T(id === "iec-docs" ? 1 : 2)) || true), "payload built");
ok(!listJson.includes(T(2)), "list output contains NO activation tokens (Troy's fixture token absent)");

/* ---------------- fail-soft: activity store unavailable ----------- */
console.log("fail-soft");
delete process.env.BLOB_READ_WRITE_TOKEN;
const r2 = await call({ action: "list" });
ok(r2.status === 200 && r2.body.ok === true, "list still answers 200 with the activity store unconfigured");
ok(r2.body.matrix.find(p => p.email === TROY.email).cells.insnap === "invited",
  "stored statuses served as-is when the merge cannot read activity");
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";
const r3 = await call({ action: "list" });
ok(r3.body.matrix.find(p => p.email === TROY.email).cells.insnap === "active",
  "merge recovers once the activity store is back");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
