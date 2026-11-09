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

/* api/demo-admin.js also imports the activity + invites stores,
   which import @vercel/blob — redirect that import to the
   in-memory mock so this suite runs locally. BLOB_READ_WRITE_TOKEN
   starts unset (activity emission is a NO-OP); the NDA-first
   section sets it, as production has it, to exercise the invites
   store against the same mock. */
register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

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
    /* A "bounce" recipient models a provider rejection (the
       production failure mode: Resend answers 403). */
    if ((body.to || []).some(t => String(t).includes("bounce"))) {
      return jsonRes(403, { name: "validation_error", message: "mock provider rejection" });
    }
    return jsonRes(200, { id: `email-${sentEmails.length}` });
  }
  if (u.startsWith("https://blob.mock/")) {
    /* The invites store cache-busts its document reads (?cb=…);
       the mock matches on the bare URL, as the Blob origin does. */
    const bare = u.split("?")[0];
    for (const rec of blobMock.__blobs.values()) {
      if (rec.url === bare) return textRes(200, rec.content);
    }
    return textRes(404, "");
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
/* The fixtures are the LIVE stores, and the Office legitimately
   adds people to them (Mohamed Ismael + esteadysteps landed
   2026-11-05, after this suite was written — its hardcoded counts
   went stale and the suite failed on drift alone). Counts are
   therefore captured as the baseline and asserted as minimums /
   relative deltas; the load-bearing contract is the per-person
   checks below (seed, DrMorgan, Colby), which must always hold. */
const base = {
  medexec: medList.length, insnap: insList.length, curavia: curList.length,
  insnapp: napList.length, "iec-docs": docList.length
};
const peopleCount = new Set(
  [...medList, ...insList, ...curList, ...napList, ...docList].map(a => a.email.toLowerCase())
).size;
ok(base.medexec >= 3, "medexec live store parses (seed + DrMorgan + Colby at minimum)");
ok(base.insnap >= 2, "insnap live store parses (seed + DrMorgan at minimum)");
ok(base.curavia >= 2 && base.insnapp >= 2 && base["iec-docs"] >= 2,
  "curavia + insnapp + iec-docs live stores parse (seed + DrMorgan at minimum)");
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
const morganMed = medList.find(a => a.email === "drmohdmorgan@gmail.com");
ok(medTokens.length === medList.length - 1 && medTokens.every(t => /^[0-9a-f]+$/.test(t)) &&
   morganMed && morganMed.token.length === 47,
  "medexec: every non-seed account carries a hex token (DrMorgan's hand-issued one is 47 chars)");
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
ok(matrix.length === peopleCount, "matrix unions to exactly the people across the five live stores");
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
ok(X.parseProvisioning(inserted).length === base.medexec + 1, "inserted file still parses (baseline + 1)");
const insertedDocs = X.insertEntry(FIXTURES["iec-docs"], newEntry);
ok(insertedDocs.replace(entryText, "") === FIXTURES["iec-docs"],
  "insert is byte-preserving on a store with a trailing module-exports block (iec-docs)");
ok(X.parseProvisioning(insertedDocs).length === base["iec-docs"] + 1, "iec-docs store still parses after insert (baseline + 1)");
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
ok(r.body.accounts.medexec.length === base.medexec && r.body.accounts.insnap.length === base.insnap &&
   r.body.accounts.curavia.length === base.curavia && r.body.accounts.insnapp.length === base.insnapp &&
   r.body.accounts["iec-docs"].length === base["iec-docs"], "list returns all five stores' accounts");
ok(r.body.matrix.length === peopleCount, "list returns the full people matrix");
const listJson = JSON.stringify(r.body);
ok(allTokens.every(t => !listJson.includes(t)), "list output contains NO activation tokens from any store");

/* ---------------- 5. invite is NDA-FIRST (2026-11-05 rule) ---------------- */
console.log("invite (NDA-first)");
/* The nda_sent records live in the Office Blob store; production
   has BLOB_READ_WRITE_TOKEN set (the activity store uses it), so
   the suite sets it from here on. Activity emission now writes to
   the in-memory mock too — no assertion depends on it either way. */
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";
const medPutsBeforeNda = stores.medexec.puts;
r = await call({ action: "invite", asset: "medexec", email: "Test.Person@Example.com", name: "Test Person" });
ok(r.status === 200 && r.body.ndaSent === true && r.body.emailed === true && r.body.state === "nda_sent",
  "invite records nda_sent + emails the NDA");
ok(stores.medexec.puts === medPutsBeforeNda, "invite makes NO GitHub commit (provisioning is the asset side's job now)");
ok(X.parseProvisioning(stores.medexec.source).length === base.medexec, "no provisioning entry was created by the invite");
ok(sentEmails.length === 1 && sentEmails[0].to[0] === "test.person@example.com", "one email, to the invitee");
ok(sentEmails[0].from === "MEDEXEC Demo Portal <onboarding@resend.dev>", "From is the Resend onboarding sender");
ok(sentEmails[0].subject.includes("confidentiality agreement"), "subject names the NDA step");
ok(sentEmails[0].html.includes("https://getmedexec.com/#nda"), "email's call to action is the MEDEXEC signing route");
ok(sentEmails[0].text.includes("Sign the NDA first"), "copy states the rule: NDA first, link follows");
ok(!sentEmails[0].html.includes("/demo/activate/") && !sentEmails[0].text.includes("/demo/activate/"),
  "the NDA email carries NO activation link");
ok(sentEmails[0].html.includes("MEDEXEC · IEC, Inc.") && sentEmails[0].html.includes("https://getmedexec.com/logo.png"), "email carries the MEDEXEC org signature");
r = await call({ action: "list" });
const ndaRow = r.body.matrix.find(row => row.email === "test.person@example.com");
ok(!!ndaRow && ndaRow.cells.medexec === "nda_sent" && ndaRow.cells.insnap === null,
  "list merges the record: the matrix shows NDA SENT under the same person");
ok(Array.isArray(r.body.invites) && r.body.invites.length === 1 &&
   r.body.invites[0].email === "test.person@example.com" && r.body.invites[0].asset === "medexec" &&
   r.body.invites[0].status === "nda_sent", "list exposes the nda_sent record");
ok(r.body.invites[0].lastEmailStatus === "sent" && r.body.invites[0].lastEmailReason === null &&
   !!r.body.invites[0].lastEmailAt,
  "delivery status (2026-11-09): the successful send is stamped on the record");

/* ---------------- 6. re-invite, NDA resend, and the flip ---------------- */
console.log("nda idempotency + flip");
r = await call({ action: "invite", asset: "medexec", email: "test.person@example.com", name: "Test Person" });
ok(r.body.ndaSent === true && r.body.resent === true && r.body.emailed === true, "re-invite re-sends the NDA (record refreshed)");
ok(stores.medexec.puts === medPutsBeforeNda, "re-invite still makes NO commit");
ok(sentEmails.length === 2 && sentEmails[1].html.includes("https://getmedexec.com/#nda"), "the re-sent email is the NDA email again");

r = await call({ action: "invite", asset: "medexec", email: "demo@medexec.example", name: "Demo Reviewer" });
ok(r.body.ndaSent === false && r.body.emailed === false && r.body.reason === "status_active",
  "invite on an active (seed) account: no NDA, no change");

r = await call({ action: "resend", asset: "medexec", email: "test.person@example.com" });
ok(r.body.emailed === true && r.body.kind === "nda" && r.body.state === "nda_sent",
  "resend on an nda_sent cell re-sends the NDA email");
ok(sentEmails[sentEmails.length - 1].html.includes("https://getmedexec.com/#nda") &&
   !sentEmails[sentEmails.length - 1].html.includes("/demo/activate/"),
  "the resend is the NDA email, not an activation link");
ok(stores.medexec.puts === medPutsBeforeNda, "NDA resend makes NO commit either");

/* The flip: the asset side provisions after the executed NDA (the
   website signing trigger). Simulate its byte-preserving insert
   directly into the mock store, exactly as demo-provision does. */
const flipEntry = {
  email: "test.person@example.com", name: "Test Person",
  token: "b".repeat(48), status: "invited", issuedAt: "2026-11-05T07:00:00-05:00"
};
stores.medexec.source = X.insertEntry(stores.medexec.source, flipEntry);
stores.medexec.puts++;
r = await call({ action: "list" });
const flippedRow = r.body.matrix.find(row => row.email === "test.person@example.com");
ok(flippedRow && flippedRow.cells.medexec === "invited",
  "once the asset store has the entry, the cell flips from nda_sent to invited on its own");
r = await call({ action: "invite", asset: "medexec", email: "test.person@example.com", name: "Test Person" });
ok(r.body.ndaSent === false && r.body.emailed === false && r.body.reason === "status_invited",
  "invite on a now-provisioned person: state reported, no NDA sent");
r = await call({ action: "resend", asset: "medexec", email: "test.person@example.com" });
ok(r.body.emailed === true && r.body.resent === true && r.body.kind !== "nda",
  "resend after the flip sends the ACTIVATION link again");
ok(sentEmails[sentEmails.length - 1].html.includes(`https://getmedexec.com/demo/activate/?token=${flipEntry.token}`),
  "the activation resend uses the provisioned token");

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
const curPutsBeforeNda = stores.curavia.puts;
r = await call({ action: "invite", asset: "curavia", email: "new.curavia@example.com", name: "Curavia Tester" });
ok(r.status === 200 && r.body.ndaSent === true && r.body.emailed === true && r.body.state === "nda_sent",
  "curavia invite is NDA-first too: record + NDA email, no provisioning");
ok(stores.curavia.puts === curPutsBeforeNda, "curavia invite makes NO commit");
ok(!X.parseProvisioning(stores.curavia.source).some(a => a.email === "new.curavia@example.com"),
  "no curavia provisioning entry was created");
let mail = sentEmails[sentEmails.length - 1];
ok(mail.from === "CURAVIA Demo Portal <onboarding@resend.dev>", "curavia email: onboarding sender");
ok(mail.html.includes("https://getcuravia.com/#signing"), "curavia NDA email points at the getcuravia.com signing route");
ok(!mail.html.includes("/demo/activate/"), "curavia NDA email carries NO activation link");
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

const napPutsBeforeNda = stores.insnapp.puts;
r = await call({ action: "invite", asset: "insnapp", email: "new.insnapp@example.com", name: "Insnapp Tester" });
ok(r.status === 200 && r.body.ndaSent === true && r.body.emailed === true && r.body.state === "nda_sent",
  "insnapp invite is NDA-first too (2026-11-05 circuit): record + NDA email, no provisioning");
ok(stores.insnapp.puts === napPutsBeforeNda, "insnapp invite makes NO commit");
ok(!X.parseProvisioning(stores.insnapp.source).some(a => a.email === "new.insnapp@example.com"),
  "no insnapp provisioning entry was created");
mail = sentEmails[sentEmails.length - 1];
ok(mail.html.includes("https://www.inssnapp.com/legal/cnda"), "insnapp NDA email points at the INSNAPP CNDA route");
ok(!mail.html.includes("/demo/activate/"), "insnapp NDA email carries NO activation link");

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
ok(r.body.ndaSent === true && r.body.emailed === false && r.body.error === "email_failed",
  "missing Resend key: nda_sent record stands, email_failed reported (no rollback)");
ok(stores.insnap.puts === insPutsBefore, "no commit was made (NDA-first never commits)");
r = await call({ action: "list" });
const failedRec = r.body.invites.find(i => i.email === "second@example.com" && i.asset === "insnap");
ok(!!failedRec && failedRec.lastEmailStatus === "failed" && failedRec.lastEmailReason === "not_configured" &&
   !!failedRec.lastEmailAt && failedRec.sends === 1,
  "delivery status (2026-11-09): the FAILED send is stamped on the record — visible in list, not just the response");
process.env.DEMO_ADMIN_RESEND_API_KEY = "resend-test-key";
r = await call({ action: "resend", asset: "insnap", email: "second@example.com" });
ok(r.body.emailed === true && r.body.kind === "nda" && r.body.state === "nda_sent",
  "resend re-sends the NDA once the key is back");
r = await call({ action: "list" });
const resentRec = r.body.invites.find(i => i.email === "second@example.com" && i.asset === "insnap");
ok(!!resentRec && resentRec.lastEmailStatus === "sent" && resentRec.lastEmailReason === null &&
   resentRec.sends === 2,
  "delivery status: the successful resend flips the record to sent and bumps the attempt count");
ok(sentEmails[sentEmails.length - 1].from === "InSnap Demo Portal <onboarding@resend.dev>" &&
   sentEmails[sentEmails.length - 1].html.includes("https://insnap-job-engine.vercel.app/legal/cnda") &&
   sentEmails[sentEmails.length - 1].html.includes("InSnap · IEC, Inc.") &&
   sentEmails[sentEmails.length - 1].html.includes("https://iecincglobal.com/assets/iec-logo-email.png"),
  "InSnap NDA email: onboarding sender, CNDA route, IEC-logo org signature");

r = await call({ action: "invite", asset: "curavia", email: "bounce@example.com", name: "Bounce Person" });
ok(r.body.ndaSent === true && r.body.emailed === false && r.body.reason === "resend_403",
  "provider rejection (403): record stands, failure reported");
r = await call({ action: "list" });
const bounceRec = r.body.invites.find(i => i.email === "bounce@example.com" && i.asset === "curavia");
ok(!!bounceRec && bounceRec.lastEmailStatus === "failed" && bounceRec.lastEmailReason === "resend_403",
  "delivery status: the provider rejection is stamped with its reason");
r = await call({ action: "resend", asset: "curavia", email: "bounce@example.com" });
ok(r.body.emailed === false && r.body.reason === "resend_403", "a failing resend reports the failure");
r = await call({ action: "list" });
const bounceRec2 = r.body.invites.find(i => i.email === "bounce@example.com" && i.asset === "curavia");
ok(!!bounceRec2 && bounceRec2.lastEmailStatus === "failed" && bounceRec2.sends === 2 &&
   bounceRec2.lastEmailAt >= bounceRec.lastEmailAt,
  "delivery status: the failed RESEND is stamped too (attempt counted, failure kept)");

/* ---------------- 13. NDA-first: routes, gates, merge ---------------- */
console.log("nda routes + merge (pure and handler)");
const assetById = Object.fromEntries(X.ASSETS.map(a => [a.id, a]));
ok(assetById.medexec.ndaRoute === "https://getmedexec.com/#nda" && assetById.medexec.ndaTrigger === true,
  "registry: MEDEXEC signing route, trigger armed");
ok(assetById.insnap.ndaRoute === "https://insnap-job-engine.vercel.app/legal/cnda" && assetById.insnap.ndaTrigger === true,
  "registry: InSnap CNDA route, trigger armed");
ok(assetById.curavia.ndaRoute === "https://getcuravia.com/#signing" && assetById.curavia.ndaTrigger === true,
  "registry: CURAVIA signing route, trigger armed (2026-11-05 circuit)");
ok(assetById.insnapp.ndaRoute === "https://www.inssnapp.com/legal/cnda" && assetById.insnapp.ndaTrigger === true &&
   assetById["iec-docs"].ndaRoute === "https://iec-docs.vercel.app/legal/cnda" && assetById["iec-docs"].ndaTrigger === true,
  "registry: INSNAPP + IEC Docs CNDA routes, triggers armed (2026-11-05 circuit)");

const ndaMail = X.buildNdaEmail(assetById.insnap, "Merge Tester");
ok(ndaMail.subject.includes("InSnap") && ndaMail.text.includes("https://insnap-job-engine.vercel.app/legal/cnda") &&
   ndaMail.text.includes("Sign the NDA first") && !ndaMail.text.includes("token="),
  "buildNdaEmail: route + rule copy, no token anywhere");

const pureNda = X.buildMatrix(accountsView, [
  { email: "pure@nda.example", name: "Pure Nda", asset: "insnap", status: "nda_sent" },
  { email: "drmohdmorgan@gmail.com", name: "", asset: "medexec", status: "nda_sent" }
]);
const pureRow = pureNda.find(row => row.email === "pure@nda.example");
ok(pureRow && pureRow.cells.insnap === "nda_sent" && pureRow.cells.medexec === null,
  "buildMatrix (pure): an nda-only person appears with an nda_sent cell");
ok(pureNda.find(row => row.email === "drmohdmorgan@gmail.com").cells.medexec === "invited",
  "buildMatrix (pure): a provisioned status always wins over an nda_sent record");

r = await call({ action: "invite", asset: "iec-docs", email: "docs.nda@example.com", name: "Docs Nda" });
ok(r.status === 200 && r.body.ndaSent === true && r.body.emailed === true && r.body.state === "nda_sent",
  "iec-docs invite is NDA-first the same way (2026-11-05 circuit)");
ok(sentEmails[sentEmails.length - 1].html.includes("https://iec-docs.vercel.app/legal/cnda"),
  "iec-docs NDA email points at the IEC Docs CNDA route");
r = await call({ action: "resend", asset: "iec-docs", email: "docs.nda@example.com" });
ok(r.body.emailed === true && r.body.kind === "nda" && r.body.state === "nda_sent",
  "resend on the iec-docs nda_sent cell re-sends the NDA email");

r = await call({ action: "invite", asset: "medexec", email: "merge@test.example", name: "Merge Tester" });
ok(r.body.ndaSent === true, "merge fixture: NDA sent on medexec");
stores.curavia.source = X.insertEntry(stores.curavia.source, {
  email: "merge@test.example", name: "Merge Tester",
  token: "c".repeat(48), status: "invited", issuedAt: "2026-11-05T07:30:00-05:00"
});
stores.curavia.puts++;
r = await call({ action: "list" });
const mergeRow = r.body.matrix.find(row => row.email === "merge@test.example");
ok(mergeRow && mergeRow.cells.medexec === "nda_sent" && mergeRow.cells.curavia === "invited" &&
   mergeRow.cells.insnap === null,
  "list merge: one person, nda_sent where only the NDA went out, invited where provisioned");
ok(r.body.assets.find(a => a.id === "insnapp").ndaRoute === true &&
   r.body.assets.find(a => a.id === "iec-docs").ndaRoute === true &&
   r.body.assets.find(a => a.id === "medexec").ndaRoute === true,
  "list reports each asset's NDA-route availability (all five have routes)");

delete process.env.BLOB_READ_WRITE_TOKEN;
const blobEmailsBefore = sentEmails.length;
r = await call({ action: "invite", asset: "medexec", email: "nobleb@example.com", name: "No Blob" });
ok(r.status === 503 && r.body.error === "not_configured",
  "invite refuses (503) when the invites store is not configured — no untracked NDA");
ok(sentEmails.length === blobEmailsBefore, "and no email went out");
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";
r = await call({ action: "invite", asset: "medexec", email: "nobleb@example.com", name: "No Blob" });
ok(r.body.ndaSent === true && r.body.emailed === true, "invite recovers once the store is configured");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
