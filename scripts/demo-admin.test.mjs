/* Local test suite for api/demo-admin.js (IEC Office Demo Control).
   Runs the real handler against fixture copies of ALL FIVE live
   provisioning stores (medexec-site, insnap-job-engine,
   getcuravia-site, inssnap-del, iec-docs), with fetch mocked for
   GitHub, Resend, and the live-file poll. No real GitHub writes,
   no real emails.

   Run: node scripts/demo-admin.test.mjs   (exit 1 on any failure) */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

/* api/demo-admin.js now also imports the activity store, which
   imports @vercel/blob — redirect that import to the in-memory
   mock so this suite runs locally (BLOB_READ_WRITE_TOKEN is unset
   here, so activity emission is a NO-OP in these tests). */
register("./testing/blob-hooks.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = {
  medexec: fs.readFileSync(path.join(here, "../../medexec-site/demo/provisioning.js"), "utf8"),
  insnap: fs.readFileSync(path.join(here, "../../insnap-job-engine/public/demo/provisioning.js"), "utf8"),
  curavia: fs.readFileSync(path.join(here, "../../getcuravia-site/demo/provisioning.js"), "utf8"),
  insnapp: fs.readFileSync(path.join(here, "../../inssnap-del/apps/web/public/demo/provisioning.js"), "utf8"),
  "iec-docs": fs.readFileSync(path.join(here, "../../iec-docs/public/demo/provisioning.js"), "utf8")
};
const ASSET_IDS = ["medexec", "insnap", "curavia", "insnapp", "iec-docs"];

/* ---------------- env ---------------- */
const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.DEMO_ADMIN_GITHUB_TOKEN_MEDEXEC = "gh-test-medexec";
process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAP = "gh-test-insnap";
process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA = "gh-test-curavia";
process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAPP = "gh-test-insnapp";
process.env.DEMO_ADMIN_GITHUB_TOKEN_IECDOCS = "gh-test-iecdocs";
process.env.DEMO_ADMIN_RESEND_API_KEY = "resend-test-key";

/* ---------------- mocked stores + fetch ---------------- */
const stores = {
  medexec: { source: FIXTURES.medexec, sha: "sha-m0", puts: 0 },
  insnap: { source: FIXTURES.insnap, sha: "sha-i0", puts: 0 },
  curavia: { source: FIXTURES.curavia, sha: "sha-c0", puts: 0 },
  insnapp: { source: FIXTURES.insnapp, sha: "sha-n0", puts: 0 },
  "iec-docs": { source: FIXTURES["iec-docs"], sha: "sha-d0", puts: 0 }
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
  insnap: "https://api.github.com/repos/drmohdmorgan-del/insnap-job-engine/contents/public/demo/provisioning.js",
  curavia: "https://api.github.com/repos/DrMorgan73/getcuravia-site/contents/demo/provisioning.js",
  insnapp: "https://api.github.com/repos/drmohdmorgan-del/inssnap-del/contents/apps/web/public/demo/provisioning.js",
  "iec-docs": "https://api.github.com/repos/DrMorgan73/iec-docs/contents/public/demo/provisioning.js"
};
const LIVE = {
  medexec: "https://getmedexec.com/demo/provisioning.js",
  insnap: "https://insnap-job-engine.vercel.app/demo/provisioning.js",
  curavia: "https://getcuravia.com/demo/provisioning.js",
  insnapp: "https://www.inssnapp.com/demo/provisioning.js",
  "iec-docs": "https://iec-docs.vercel.app/demo/provisioning.js"
};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  for (const id of ASSET_IDS) {
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

/* ---------------- handler + mocks ---------------- */
const mod = await import("../api/demo-admin.js");
const handler = mod.default;
const X = mod._internals;

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}

async function call(body, cookie) {
  const req = {
    method: "POST",
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
  return { status: res.statusCode, body: res.payload };
}

/* ---------------- tiny assert kit ---------------- */
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------------- 1. parse all five real stores ---------------- */
console.log("parse + matrix (pure)");
const medList = X.parseProvisioning(FIXTURES.medexec);
const insList = X.parseProvisioning(FIXTURES.insnap);
const curList = X.parseProvisioning(FIXTURES.curavia);
const napList = X.parseProvisioning(FIXTURES.insnapp);
const docList = X.parseProvisioning(FIXTURES["iec-docs"]);
ok(medList.length === 3, "medexec fixture parses to 3 accounts");
ok(insList.length === 2, "insnap fixture parses to 2 accounts");
ok(curList.length === 2 && napList.length === 2 && docList.length === 2,
  "curavia + insnapp + iec-docs fixtures parse to 2 accounts each");
const medSeed = medList.find(a => a.email === "demo@medexec.example");
const insSeed = insList.find(a => a.email === "demo@insnap.example");
ok(medSeed && medSeed.status === "active" && !medSeed.token, "medexec seed: active, no token");
ok(insSeed && insSeed.status === "active" && !insSeed.token, "insnap seed: active, no token");
for (const [list, seedEmail, label] of [
  [curList, "demo@curavia.example", "curavia"],
  [napList, "demo@insnapp.example", "insnapp"],
  [docList, "demo@iecdocs.example", "iec-docs"]
]) {
  const seed = list.find(a => a.email === seedEmail);
  ok(seed && seed.status === "active" && !seed.token, `${label} seed: active, no token`);
  const m = list.find(a => a.email === "drmohdmorgan@gmail.com");
  ok(m && m.status === "invited" && /^[0-9a-f]{48}$/.test(m.token), `${label}: DrMorgan invited with a 48-hex token`);
}
const medTokens = medList.filter(a => a.token).map(a => a.token);
ok(medTokens.length === 2 && medTokens.every(t => /^[0-9a-f]+$/.test(t)), "medexec real accounts carry hex tokens (one hand-issued at 47 chars)");
const allTokens = ASSET_IDS.flatMap(id => X.parseProvisioning(FIXTURES[id]).filter(a => a.token).map(a => a.token));

const accountsView = {
  medexec: medList.map(X.publicAccount),
  insnap: insList.map(X.publicAccount),
  curavia: curList.map(X.publicAccount),
  insnapp: napList.map(X.publicAccount),
  "iec-docs": docList.map(X.publicAccount)
};
ok(ASSET_IDS.every(id => accountsView[id].every(a => !("token" in a))), "publicAccount never exposes a token field");
const matrix = X.buildMatrix(accountsView);
ok(matrix.length === 7, "matrix unions to 7 people (DrMorgan, Colby, 5 asset seeds)");
const morgan = matrix.find(r => r.email === "drmohdmorgan@gmail.com");
ok(ASSET_IDS.every(id => morgan.cells[id] === "invited"), "matrix: DrMorgan invited on all five live assets");
const colby = matrix.find(r => r.email === "colby@impactinsuranceut.com");
ok(colby && colby.cells.medexec === "invited" && colby.cells.insnap === null &&
   colby.cells.curavia === null && colby.cells.insnapp === null && colby.cells["iec-docs"] === null,
  "matrix: Colby medexec-only");

/* ---------------- 2. byte-preserving edits (pure) ---------------- */
console.log("byte preservation (pure)");
const flipped = X.setStatusInSource(FIXTURES.insnap, "drmohdmorgan@gmail.com", "paused");
ok(flipped.replace('status: "paused"', 'status: "invited"') === FIXTURES.insnap,
  "status flip changes only the status value");
const flippedSeed = X.setStatusInSource(FIXTURES.medexec, "demo@medexec.example", "paused");
ok(flippedSeed.replace('status: "paused"', 'status: "active"') === FIXTURES.medexec,
  "seed status flip is byte-preserving too");
const newEntry = { email: "pure@test.example", name: "Pure Test", token: "a".repeat(48), status: "invited", issuedAt: "2026-11-05T06:00:00-05:00" };
const inserted = X.insertEntry(FIXTURES.medexec, newEntry);
const entryText = ",\n  {\n" +
  `    email: "pure@test.example",\n    name: "Pure Test",\n    token: "${"a".repeat(48)}",\n` +
  `    status: "invited",\n    issuedAt: "2026-11-05T06:00:00-05:00"\n  }`;
ok(inserted.replace(entryText, "") === FIXTURES.medexec, "insert adds exactly the new entry, nothing else moves");
ok(X.parseProvisioning(inserted).length === 4, "inserted file still parses (4 accounts)");
const insertedDocs = X.insertEntry(FIXTURES["iec-docs"], newEntry);
ok(insertedDocs.replace(entryText, "") === FIXTURES["iec-docs"],
  "insert is byte-preserving on a store with a trailing module-exports block (iec-docs)");
ok(X.parseProvisioning(insertedDocs).length === 3, "iec-docs store still parses after insert (3 accounts)");
const flippedNap = X.setStatusInSource(FIXTURES.insnapp, "drmohdmorgan@gmail.com", "paused");
ok(flippedNap.replace('status: "paused"', 'status: "invited"') === FIXTURES.insnapp,
  "status flip is byte-preserving on the insnapp store too");

/* ---------------- 3. auth ---------------- */
console.log("auth");
let r = await call({ action: "list" }, null);
ok(r.status === 401 && r.body.error === "unauthorized", "401 with no session cookie");
r = await call({ action: "list" }, "desk_session=bogus.123.deadbeef");
ok(r.status === 401, "401 with a forged session cookie");
const expired = sessionCookie("drmorgan", Math.floor(Date.now() / 1000) - 60);
r = await call({ action: "list" }, expired);
ok(r.status === 401, "401 with an expired session cookie");

/* ---------------- 4. list action ---------------- */
console.log("list action");
r = await call({ action: "list" });
ok(r.status === 200 && r.body.ok === true, "list answers 200");
ok(r.body.assets.length === 5, "registry lists 5 assets (website + application scope only)");
ok(eq(r.body.assets.map(a => a.id), ["medexec", "insnap", "curavia", "insnapp", "iec-docs"]),
  "registry order: medexec, insnap, curavia, insnapp, iec-docs");
ok(r.body.assets.every(a => a.live), "all five assets are live — no planned entries remain");
ok(r.body.assets.every(a => a.configured === true), "all five report configured:true when every token is set");
ok(r.body.accounts.medexec.length === 3 && r.body.accounts.insnap.length === 2 &&
   r.body.accounts.curavia.length === 2 && r.body.accounts.insnapp.length === 2 &&
   r.body.accounts["iec-docs"].length === 2, "list returns all five stores' accounts");
ok(r.body.matrix.length === 7, "list returns the 7-person matrix");
const listJson = JSON.stringify(r.body);
ok(allTokens.every(t => !listJson.includes(t)), "list output contains NO activation tokens from any store");

/* ---------------- 5. invite (new) + byte preservation + email ---------------- */
console.log("invite");
const beforeInvite = stores.medexec.source;
r = await call({ action: "invite", asset: "medexec", email: "Test.Person@Example.com", name: "Test Person" });
ok(r.status === 200 && r.body.created === true && r.body.emailed === true, "invite creates + emails");
ok(stores.medexec.puts === 1, "invite made exactly one commit");
ok(stores.medexec.lastMessage === "IEC Office: invite test.person@example.com to MEDEXEC demo", "commit message follows the pattern");
const afterInvite = X.parseProvisioning(stores.medexec.source);
ok(afterInvite.length === 4, "store now has 4 accounts");
const testEntry = afterInvite.find(a => a.email === "test.person@example.com");
ok(testEntry && testEntry.status === "invited" && /^[0-9a-f]{48}$/.test(testEntry.token), "new entry: invited with a fresh token");
ok(/^-0[45]:00$/.test(testEntry.issuedAt.slice(-6)), "issuedAt carries the Eastern offset");
const insertedText = ",\n  {\n" +
  `    email: "test.person@example.com",\n    name: "Test Person",\n    token: "${testEntry.token}",\n` +
  `    status: "invited",\n    issuedAt: "${testEntry.issuedAt}"\n  }`;
ok(stores.medexec.source.replace(insertedText, "") === beforeInvite, "committed insert is byte-preserving");
ok(sentEmails.length === 1 && sentEmails[0].to[0] === "test.person@example.com", "one activation email, to the invitee");
ok(sentEmails[0].from === "MEDEXEC Demo Portal <onboarding@resend.dev>", "From is the Resend onboarding sender");
ok(sentEmails[0].html.includes(`https://getmedexec.com/demo/activate/?token=${testEntry.token}`), "email carries the activation link");
ok(sentEmails[0].html.includes("MEDEXEC · IEC, Inc.") && sentEmails[0].html.includes("https://getmedexec.com/logo.png"), "email carries the MEDEXEC org signature");

/* ---------------- 6. idempotent invite ---------------- */
console.log("idempotency");
const putsBefore = stores.medexec.puts;
r = await call({ action: "invite", asset: "medexec", email: "test.person@example.com", name: "Test Person" });
ok(r.body.created === false && r.body.resent === true && r.body.emailed === true, "re-invite resends the same link");
ok(stores.medexec.puts === putsBefore, "re-invite makes NO new commit");
ok(X.parseProvisioning(stores.medexec.source).length === 4, "no duplicate entry");
ok(sentEmails.length === 2 && sentEmails[1].html.includes(testEntry.token), "resent email uses the SAME token");

r = await call({ action: "invite", asset: "medexec", email: "demo@medexec.example", name: "Demo Reviewer" });
ok(r.body.created === false && r.body.emailed === false && r.body.reason === "status_active",
  "invite on an active (seed) account: no change, no email");

/* ---------------- 7. status flips through the handler ---------------- */
console.log("status");
const insBefore = stores.insnap.source;
r = await call({ action: "status", asset: "insnap", email: "drmohdmorgan@gmail.com", status: "paused" });
ok(r.status === 200 && r.body.changed === true && r.body.previousStatus === "invited" && r.body.status === "paused",
  "status flip invited -> paused");
ok(stores.insnap.source.replace('status: "paused"', 'status: "invited"') === insBefore,
  "committed flip is byte-preserving");
ok(stores.insnap.lastMessage === "IEC Office: set drmohdmorgan@gmail.com on InSnap to paused", "status commit message follows the pattern");
r = await call({ action: "status", asset: "insnap", email: "drmohdmorgan@gmail.com", status: "paused" });
ok(r.body.changed === false, "same-status set is a no-op (changed:false)");

r = await call({ action: "status", asset: "insnap", email: "demo@insnap.example", status: "paused" });
ok(r.status === 200 && r.body.changed === true, "seed account may be status-flipped");
r = await call({ action: "status", asset: "insnap", email: "demo@insnap.example", status: "active" });
ok(r.body.changed === true && r.body.previousStatus === "paused", "seed resumed to active");

/* ---------------- 8. revoked -> invited refusal ---------------- */
console.log("transitions");
r = await call({ action: "status", asset: "medexec", email: "colby@impactinsuranceut.com", status: "revoked" });
ok(r.body.changed === true && r.body.status === "revoked", "revoke works");
const putsAtRevoke = stores.medexec.puts;
r = await call({ action: "status", asset: "medexec", email: "colby@impactinsuranceut.com", status: "invited" });
ok(r.status === 400 && r.body.error === "status_transition_forbidden", "revoked -> invited is refused");
ok(stores.medexec.puts === putsAtRevoke, "refusal makes no commit");
r = await call({ action: "invite", asset: "medexec", email: "colby@impactinsuranceut.com", name: "Colby Hepler" });
ok(r.body.emailed === false && r.body.reason === "status_revoked", "invite on revoked: no email, state reported");
r = await call({ action: "status", asset: "medexec", email: "colby@impactinsuranceut.com", status: "active" });
ok(r.body.changed === true && r.body.previousStatus === "revoked", "revoked -> active (reactivate) is allowed");

/* ---------------- 9. resend rules ---------------- */
console.log("resend");
const emailsBefore = sentEmails.length;
r = await call({ action: "resend", asset: "insnap", email: "drmohdmorgan@gmail.com" });
ok(r.body.emailed === false && r.body.reason === "status_paused", "resend on paused: no send, state reported");
ok(sentEmails.length === emailsBefore, "no email left the mock");
r = await call({ action: "status", asset: "insnap", email: "drmohdmorgan@gmail.com", status: "invited" });
ok(r.status === 400, "paused -> invited is refused too (invited is never settable)");
r = await call({ action: "resend", asset: "medexec", email: "ghost@example.com" });
ok(r.status === 404 && r.body.error === "not_found", "resend on unknown email: 404");
r = await call({ action: "resend", asset: "medexec", email: "drmohdmorgan@gmail.com" });
ok(r.body.emailed === true && r.body.resent === true, "resend on invited sends");
const morganToken = medList.find(a => a.email === "drmohdmorgan@gmail.com").token;
ok(sentEmails[sentEmails.length - 1].html.includes(`token=${morganToken}`), "resend uses the existing token");

/* ---------------- 9b. the three new live assets act uniformly ---------------- */
console.log("new live assets");
r = await call({ action: "invite", asset: "curavia", email: "new.curavia@example.com", name: "Curavia Tester" });
ok(r.status === 200 && r.body.created === true && r.body.emailed === true, "curavia invite creates + emails");
ok(stores.curavia.lastMessage === "IEC Office: invite new.curavia@example.com to CURAVIA demo", "curavia commit message follows the pattern");
let mail = sentEmails[sentEmails.length - 1];
const curEntry = X.parseProvisioning(stores.curavia.source).find(a => a.email === "new.curavia@example.com");
ok(mail.from === "CURAVIA Demo Portal <onboarding@resend.dev>", "curavia email: onboarding sender");
ok(mail.html.includes(`https://getcuravia.com/demo/activate/?token=${curEntry.token}`), "curavia email carries its activation link");
ok(mail.html.includes("CURAVIA · IEC, Inc.") && mail.html.includes("https://iecincglobal.com/assets/iec-logo-email.png") &&
   mail.html.includes("info@getcuravia.com"), "curavia email carries the IEC-logo org signature");

const napBefore = stores.insnapp.source;
r = await call({ action: "status", asset: "insnapp", email: "drmohdmorgan@gmail.com", status: "paused" });
ok(r.status === 200 && r.body.changed === true && r.body.previousStatus === "invited", "insnapp status flip invited -> paused");
ok(stores.insnapp.source.replace('status: "paused"', 'status: "invited"') === napBefore,
  "insnapp committed flip is byte-preserving");
ok(stores.insnapp.lastMessage === "IEC Office: set drmohdmorgan@gmail.com on INSNAPP to paused", "insnapp commit message follows the pattern");
r = await call({ action: "status", asset: "insnapp", email: "drmohdmorgan@gmail.com", status: "active" });
ok(r.body.changed === true && r.body.previousStatus === "paused", "insnapp resumed to active");

r = await call({ action: "invite", asset: "insnapp", email: "new.insnapp@example.com", name: "Insnapp Tester" });
ok(r.status === 200 && r.body.created === true && r.body.emailed === true, "insnapp invite creates + emails");
mail = sentEmails[sentEmails.length - 1];
const napEntry = X.parseProvisioning(stores.insnapp.source).find(a => a.email === "new.insnapp@example.com");
ok(mail.from === "INSNAPP Demo Portal <onboarding@resend.dev>", "insnapp email: onboarding sender");
ok(mail.html.includes(`https://www.inssnapp.com/demo/activate/?token=${napEntry.token}`), "insnapp email carries its activation link");
ok(mail.html.includes("INSNAPP · IEC, Inc.") && mail.html.includes("https://iecincglobal.com/assets/iec-logo-email.png"),
  "insnapp email carries the IEC-logo org signature");

r = await call({ action: "resend", asset: "iec-docs", email: "drmohdmorgan@gmail.com" });
ok(r.body.emailed === true && r.body.resent === true, "iec-docs resend on invited sends");
mail = sentEmails[sentEmails.length - 1];
const docToken = docList.find(a => a.email === "drmohdmorgan@gmail.com").token;
ok(mail.from === "IEC Docs Demo Portal <onboarding@resend.dev>", "iec-docs email: onboarding sender");
ok(mail.html.includes(`https://iec-docs.vercel.app/demo/activate/?token=${docToken}`), "iec-docs resend uses the existing token + base");
ok(mail.html.includes("IEC Docs · IEC, Inc.") && mail.html.includes("https://iecincglobal.com/assets/iec-logo-email.png"),
  "iec-docs email carries the IEC-logo org signature");
r = await call({ action: "status", asset: "curavia", email: "demo@curavia.example", status: "revoked" });
ok(r.status === 200 && r.body.changed === true, "curavia seed account may be status-flipped");
r = await call({ action: "status", asset: "curavia", email: "demo@curavia.example", status: "active" });
ok(r.body.changed === true && r.body.previousStatus === "revoked", "curavia seed reactivated");

/* ---------------- 10. bad input ---------------- */
console.log("validation");
r = await call({ action: "status", asset: "nope", email: "x@example.com", status: "paused" });
ok(r.status === 400 && r.body.error === "unknown_asset", "unknown asset refused");
r = await call({ action: "invite", asset: "insnap", email: "not-an-email", name: "X" });
ok(r.status === 400 && r.body.error === "invalid_email", "bad email refused");
r = await call({ action: "invite", asset: "insnap", email: "new@example.com", name: "" });
ok(r.status === 400 && r.body.error === "name_required", "new invite without a name refused");
r = await call({ action: "bogus" });
ok(r.status === 400 && r.body.error === "unknown_action", "unknown action refused");

/* ---------------- 11. fail-closed env (per asset) ---------------- */
console.log("fail-closed");
delete process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAP;
r = await call({ action: "list" });
ok(r.status === 200 && r.body.ok === true, "list still answers 200 when ONE asset token is missing");
const insnapAsset = r.body.assets.find(a => a.id === "insnap");
ok(insnapAsset.configured === false, "the tokenless asset reports configured:false");
ok(r.body.assets.filter(a => a.id !== "insnap").every(a => a.configured === true),
  "every other asset stays configured:true");
ok(Array.isArray(r.body.accounts.insnap) && r.body.accounts.insnap.length === 0,
  "the tokenless asset's store is not read (empty accounts)");
ok(r.body.accounts.medexec.length >= 3 && r.body.accounts.curavia.length >= 2,
  "configured assets still return their accounts");
const fcMorgan = r.body.matrix.find(row => row.email === "drmohdmorgan@gmail.com");
ok(fcMorgan && fcMorgan.cells.insnap === null && fcMorgan.cells.medexec === "invited",
  "matrix: tokenless asset's cells are empty, others intact");
ok(!r.body.matrix.some(row => row.email === "demo@insnap.example"),
  "people who exist only on the tokenless asset are absent from the matrix");
r = await call({ action: "status", asset: "insnap", email: "drmohdmorgan@gmail.com", status: "active" });
ok(r.status === 503 && r.body.error === "not_configured", "asset action 503 when its token is missing");
r = await call({ action: "status", asset: "medexec", email: "drmohdmorgan@gmail.com", status: "invited" });
ok(r.status === 400, "other assets' actions are unaffected (400 here is the invited-transition rule, not 503)");
process.env.DEMO_ADMIN_GITHUB_TOKEN_INSNAP = "gh-test-insnap";
r = await call({ action: "list" });
ok(r.status === 200 && r.body.assets.every(a => a.configured === true), "list recovers fully once env is restored");
delete process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA;
r = await call({ action: "list" });
ok(r.status === 200 && r.body.assets.find(a => a.id === "curavia").configured === false &&
   r.body.assets.filter(a => a.id !== "curavia").every(a => a.configured === true),
  "per-asset fail-closed holds for curavia too");
process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA = "gh-test-curavia";

/* ---------------- 12. email failure after commit ---------------- */
console.log("email failure");
delete process.env.DEMO_ADMIN_RESEND_API_KEY;
const insPutsBefore = stores.insnap.puts;
r = await call({ action: "invite", asset: "insnap", email: "second@example.com", name: "Second Person" });
ok(r.body.created === true && r.body.emailed === false && r.body.error === "email_failed",
  "missing Resend key: account created, email_failed reported (no rollback)");
ok(stores.insnap.puts === insPutsBefore + 1, "the commit stands");
process.env.DEMO_ADMIN_RESEND_API_KEY = "resend-test-key";
r = await call({ action: "resend", asset: "insnap", email: "second@example.com" });
ok(r.body.emailed === true, "resend succeeds once the key is back");
ok(sentEmails[sentEmails.length - 1].from === "InSnap Demo Portal <onboarding@resend.dev>" &&
   sentEmails[sentEmails.length - 1].html.includes("InSnap · IEC, Inc.") &&
   sentEmails[sentEmails.length - 1].html.includes("https://iecincglobal.com/assets/iec-logo-email.png"),
  "InSnap email: onboarding sender + IEC-logo org signature");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
