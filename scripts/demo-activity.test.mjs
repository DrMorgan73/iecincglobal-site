/* Local test suite for api/demo-activity.js + api/_demo-activity-store.js
   and the activity emission added to api/demo-admin.js.

   @vercel/blob is redirected to an in-memory mock (scripts/testing/)
   via module hooks; fetch is mocked for GitHub, Resend, the live-file
   poll, and blob URLs. No real Blob store, no real GitHub writes, no
   real emails.

   Run: node scripts/demo-activity.test.mjs   (exit 1 on any failure) */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = {
  medexec: fs.readFileSync(path.join(here, "../../medexec-site/demo/provisioning.js"), "utf8"),
  insnap: fs.readFileSync(path.join(here, "../../insnap-job-engine/public/demo/provisioning.js"), "utf8")
};
const blobMock = await import("./testing/blob-mock.mjs");
const { __blobs } = blobMock;

/* ---------------- env ---------------- */
const SECRET = "test-desk-secret";
const ACTIVITY_SECRET = "test-activity-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.DEMO_ADMIN_GITHUB_TOKEN_MEDEXEC = "gh-test-medexec";
process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAP = "gh-test-insnap";
process.env.DEMO_ADMIN_RESEND_API_KEY = "resend-test-key";
delete process.env.DEMO_ACTIVITY_SECRET;
delete process.env.BLOB_READ_WRITE_TOKEN;

/* ---------------- mocked stores + fetch ---------------- */
const stores = {
  medexec: { source: FIXTURES.medexec, sha: "sha-m0", puts: 0 },
  insnap: { source: FIXTURES.insnap, sha: "sha-i0", puts: 0 }
};
const sentEmails = [];

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

const GH = {
  medexec: "https://api.github.com/repos/DrMorgan73/medexec-site/contents/demo/provisioning.js",
  insnap: "https://api.github.com/repos/drmohdmorgan-del/insnap-job-engine/contents/public/demo/provisioning.js"
};
const LIVE = {
  medexec: "https://getmedexec.com/demo/provisioning.js",
  insnap: "https://insnap-job-engine.vercel.app/demo/provisioning.js"
};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://blob.mock/")) {
    const rec = __blobs.get(decodeURIComponent(u.slice("https://blob.mock/".length).split("?")[0]));
    return rec ? textRes(200, rec.content) : textRes(404, "");
  }
  for (const id of ["medexec", "insnap"]) {
    if (u === GH[id]) {
      const store = stores[id];
      if ((opts.method || "GET") === "PUT") {
        const body = JSON.parse(opts.body);
        if (body.sha !== store.sha) return jsonRes(409, { message: "sha mismatch" });
        store.source = Buffer.from(body.content, "base64").toString("utf8");
        store.sha = `sha-${id}-${++store.puts}`;
        store.lastMessage = body.message;
        return jsonRes(200, { content: { sha: store.sha } });
      }
      return jsonRes(200, {
        sha: store.sha,
        content: Buffer.from(store.source, "utf8").toString("base64")
      });
    }
    if (u.startsWith(LIVE[id])) return textRes(200, stores[id].source);
  }
  if (u === "https://api.resend.com/emails") {
    const body = JSON.parse(opts.body);
    sentEmails.push(body);
    return jsonRes(200, { id: `email-${sentEmails.length}` });
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- handlers + mocks ---------------- */
const activity = (await import("../api/demo-activity.js")).default;
const adminMod = await import("../api/demo-admin.js");
const admin = adminMod.default;
const AX = adminMod._internals;
const store = await import("../api/_demo-activity-store.js");

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}

function mockRes() {
  return {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader() {},
    end(s) { this.payload = JSON.parse(s); }
  };
}

async function postEvent(body, headers = {}) {
  const req = {
    method: "POST",
    headers: { "x-demo-activity-secret": ACTIVITY_SECRET, ...headers },
    body
  };
  const res = mockRes();
  await activity(req, res);
  return { status: res.statusCode, body: res.payload };
}

async function getFeed(query = {}, cookie) {
  const req = {
    method: "GET",
    headers: cookie === null ? {} : { cookie: cookie ?? sessionCookie() },
    query
  };
  const res = mockRes();
  await activity(req, res);
  return { status: res.statusCode, body: res.payload };
}

async function adminCall(body) {
  const req = { method: "POST", headers: { cookie: sessionCookie() }, body };
  const res = mockRes();
  await admin(req, res);
  return { status: res.statusCode, body: res.payload };
}

/* ---------------- tiny assert kit ---------------- */
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

const now = Date.now();
const iso = ms => new Date(now + ms).toISOString();

/* ---------------- 1. ingest fail-closed ---------------- */
console.log("ingest auth + fail-closed");
let r = await postEvent({ asset: "medexec", email: "a@example.com", event: "login", ts: iso(0) });
ok(r.status === 503 && r.body.error === "not_configured", "503 when DEMO_ACTIVITY_SECRET is not set");
process.env.DEMO_ACTIVITY_SECRET = ACTIVITY_SECRET;
r = await postEvent({ asset: "medexec", email: "a@example.com", event: "login", ts: iso(0) }, { "x-demo-activity-secret": "" });
ok(r.status === 401 && r.body.error === "unauthorized", "401 with no secret header");
r = await postEvent({ asset: "medexec", email: "a@example.com", event: "login", ts: iso(0) }, { "x-demo-activity-secret": "wrong-secret-value" });
ok(r.status === 401, "401 with a wrong secret");
r = await postEvent({ asset: "medexec", email: "a@example.com", event: "login", ts: iso(0) });
ok(r.status === 503 && r.body.error === "not_configured", "503 when BLOB_READ_WRITE_TOKEN is not set (never 500)");
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";
r = await getFeed({}, null);
ok(r.status === 401 && r.body.error === "unauthorized", "GET 401 with no session cookie");
r = await getFeed({}, "desk_session=bogus.123.deadbeef");
ok(r.status === 401, "GET 401 with a forged session cookie");

/* ---------------- 2. ingest validation ---------------- */
console.log("ingest validation");
r = await postEvent({ asset: "nope", email: "a@example.com", event: "login", ts: iso(0) });
ok(r.status === 400 && r.body.error === "unknown_asset", "unknown asset refused");
r = await postEvent({ asset: "medexec", email: "not-an-email", event: "login", ts: iso(0) });
ok(r.status === 400 && r.body.error === "invalid_event", "bad email refused");
r = await postEvent({ asset: "medexec", email: "a@example.com", ts: iso(0) });
ok(r.status === 400 && r.body.error === "invalid_event", "missing event type refused");
ok(__blobs.size === 0, "refused events write nothing");

/* ---------------- 3. append format ---------------- */
console.log("append + blob layout");
const LOGIN_TS = iso(-60_000);
r = await postEvent({
  asset: "medexec", email: "Colby@ImpactInsuranceUT.com", name: "Colby Hepler",
  event: "login", detail: "Portal sign-in", ts: LOGIN_TS, seed: false
});
ok(r.status === 200 && r.body.ok === true, "valid event accepted");
const medexecPath = `demo-activity/medexec/${store.dayKey(new Date(LOGIN_TS))}.jsonl`;
ok(__blobs.has(medexecPath), "stored at demo-activity/<asset>/<ET day>.jsonl");
let lines = __blobs.get(medexecPath).content.trim().split("\n");
ok(lines.length === 1, "one JSON line after one event");
const stored1 = JSON.parse(lines[0]);
ok(stored1.asset === "medexec" && stored1.email === "colby@impactinsuranceut.com" &&
   stored1.event === "login" && stored1.ts === new Date(LOGIN_TS).toISOString() &&
   stored1.seed === false && !("unknown" in stored1),
  "stored line: normalized email, exact known fields, no unknown flag");
ok(!("token" in stored1) && !("password" in stored1), "stored line carries no token/password fields");

r = await postEvent({
  asset: "medexec", email: "colby@impactinsuranceut.com", name: "Colby Hepler",
  event: "teleported", detail: { step: "3", token: "MUST-NOT-STORE", password: "MUST-NOT-STORE" },
  ts: iso(-50_000)
});
ok(r.status === 200, "unknown event type is still stored");
lines = __blobs.get(medexecPath).content.trim().split("\n");
ok(lines.length === 2, "second event appends a second line to the same object");
const stored2 = JSON.parse(lines[1]);
ok(stored2.unknown === true, "unknown event type is flagged unknown:true");
ok(!lines[1].includes("MUST-NOT-STORE"), "token/password keys are stripped from object details");

/* ---------------- 4. GET feed: order + filters + limit ---------------- */
console.log("feed");
await postEvent({ asset: "insnap", email: "colby@impactinsuranceut.com", name: "Colby Hepler", event: "login", detail: "InSnap sign-in", ts: iso(-40_000) });
await postEvent({ asset: "medexec", email: "colby@impactinsuranceut.com", name: "Colby Hepler", event: "step_view", detail: "Step 4 — Pertinent Report", ts: iso(-30_000) });
await postEvent({ asset: "medexec", email: "drmohdmorgan@gmail.com", name: "Mohammed M. Morgan, M.D.", event: "login_failed", detail: "Bad password", ts: iso(-20_000) });
await postEvent({ asset: "medexec", email: "colby@impactinsuranceut.com", name: "Colby Hepler", event: "logout", detail: "", ts: iso(-10_000) });

r = await getFeed({});
ok(r.status === 200 && r.body.ok === true && r.body.windowDays === 7, "feed answers 200 with the 7-day window");
ok(r.body.events.length === 6, "feed returns every stored event");
ok(r.body.events[0].event === "logout" && r.body.events[r.body.events.length - 1].event === "login",
  "feed is newest-first");
const feedJson = JSON.stringify(r.body);
ok(!feedJson.includes("MUST-NOT-STORE"), "feed never echoes stripped secrets");

r = await getFeed({ asset: "insnap" });
ok(r.body.events.length === 1 && r.body.events[0].asset === "insnap", "asset filter narrows the feed");
r = await getFeed({ email: "COLBY@impactinsuranceut.com" });
ok(r.body.events.length === 5 && r.body.events.every(e => e.email === "colby@impactinsuranceut.com"),
  "email filter is exact + case-insensitive");
r = await getFeed({ limit: "2" });
ok(r.body.events.length === 2 && r.body.events[0].event === "logout", "limit is honored, newest kept");
r = await getFeed({ asset: "bogus" });
ok(r.status === 400 && r.body.error === "unknown_asset", "feed refuses an unknown asset filter");

/* ---------------- 5. summary rollup ---------------- */
console.log("summary");
await postEvent({ asset: "medexec", email: "colby@impactinsuranceut.com", name: "Colby Hepler", event: "activated", detail: "Set password", ts: iso(-70_000) });
await postEvent({ asset: "insnap", email: "colby@impactinsuranceut.com", name: "Colby Hepler", event: "step_view", detail: "Combined flow", ts: iso(-5_000) });
r = await getFeed({ summary: "1" });
ok(r.status === 200 && Array.isArray(r.body.summary), "summary answers with a rollup list");
const colbyRow = r.body.summary.find(u => u.email === "colby@impactinsuranceut.com");
ok(colbyRow.counts.activated === 1 && colbyRow.counts.login === 2 &&
   colbyRow.counts.step_view === 2 && colbyRow.counts.logout === 1 &&
   colbyRow.counts.teleported === 1 && colbyRow.total === 7,
  "rollup counts by event type are exact");
ok(colbyRow.lastActivity === new Date(iso(-5_000)).toISOString(), "rollup lastActivity is the newest ts");
ok(colbyRow.firstSeen === new Date(iso(-70_000)).toISOString(), "rollup firstSeen is the oldest ts");
ok(JSON.stringify(colbyRow.assets) === JSON.stringify(["insnap", "medexec"]), "rollup lists assets touched, sorted");
ok(colbyRow.name === "Colby Hepler", "rollup carries the latest name");
const morganRow = r.body.summary.find(u => u.email === "drmohdmorgan@gmail.com");
ok(morganRow && morganRow.counts.login_failed === 1 && morganRow.total === 1, "second user rolls up separately");
ok(r.body.summary[0].email === "colby@impactinsuranceut.com", "rollup is sorted by last activity, newest first");
r = await getFeed({ summary: "1", email: "drmohdmorgan@gmail.com" });
ok(r.body.summary.length === 1 && r.body.summary[0].email === "drmohdmorgan@gmail.com",
  "summary honors the email filter");

/* ---------------- 6. demo-admin emits Office events ---------------- */
console.log("demo-admin emission");
/* NDA-first (2026-11-05): an Office invite records nda_sent and
   emails the NDA — it no longer provisions, so it emits nda_sent,
   not invite_sent. Provisioning (and invite_sent) arrives only
   when the asset side provisions after the executed NDA; the flip
   is simulated below with the same byte-preserving insert the
   asset endpoints use. */
r = await adminCall({ action: "invite", asset: "insnap", email: "watcher@example.com", name: "Watcher Person" });
ok(r.status === 200 && r.body.ndaSent === true && r.body.emailed === true, "office invite is NDA-first end to end");
r = await getFeed({ email: "watcher@example.com" });
ok(r.body.events.length === 1 && r.body.events[0].event === "nda_sent" &&
   r.body.events[0].asset === "insnap" && /IEC Office/.test(r.body.events[0].detail),
  "invite emits nda_sent (visible in the feed)");

r = await adminCall({ action: "status", asset: "insnap", email: "watcher@example.com", status: "paused" });
ok(r.status === 404 && r.body.error === "not_found",
  "status on an nda_sent-only person: 404 — nothing is provisioned yet");
stores.insnap.source = AX.insertEntry(stores.insnap.source, {
  email: "watcher@example.com", name: "Watcher Person",
  token: "d".repeat(48), status: "invited", issuedAt: "2026-11-05T07:00:00-05:00"
});

r = await adminCall({ action: "status", asset: "insnap", email: "watcher@example.com", status: "paused" });
ok(r.body.changed === true, "office status change works (once provisioned)");
r = await getFeed({ email: "watcher@example.com" });
const statusEvt = r.body.events.find(e => e.event === "status_changed");
ok(!!statusEvt && statusEvt.detail.includes("invited") && statusEvt.detail.includes("paused"),
  "status change emits status_changed with from → to");

r = await adminCall({ action: "status", asset: "insnap", email: "watcher@example.com", status: "invited" });
ok(r.status === 400, "invited is still never settable (guard intact)");
const watcherNdas = (await getFeed({ email: "watcher@example.com" })).body.events
  .filter(e => e.event === "nda_sent").length;
ok(watcherNdas === 1, "exactly one nda_sent recorded for the watcher invite");
r = await getFeed({ email: "drmohdmorgan@gmail.com" });
ok(r.body.events.filter(e => e.event === "status_changed").length === 0,
  "no status_changed events leak onto other users");

await adminCall({ action: "status", asset: "medexec", email: "drmohdmorgan@gmail.com", status: "paused" });
r = await adminCall({ action: "status", asset: "medexec", email: "drmohdmorgan@gmail.com", status: "active" });
ok(r.body.changed === true && r.body.previousStatus === "paused", "resume works alongside monitoring");
r = await getFeed({ email: "drmohdmorgan@gmail.com" });
ok(r.body.events.filter(e => e.event === "status_changed").length === 2,
  "both office status changes were recorded");

/* resend path: Colby's fixture account is invited on MEDEXEC */
const colbyInvitesBefore = (await getFeed({ email: "colby@impactinsuranceut.com" })).body.events
  .filter(e => e.event === "invite_sent").length;
r = await adminCall({ action: "resend", asset: "medexec", email: "colby@impactinsuranceut.com" });
ok(r.body.emailed === true && r.body.resent === true, "office resend still sends");
const colbyInvitesAfter = (await getFeed({ email: "colby@impactinsuranceut.com" })).body.events
  .filter(e => e.event === "invite_sent").length;
ok(colbyInvitesAfter === colbyInvitesBefore + 1, "resend emits its own invite_sent event");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
