/* Local test suite for the demo-admin "mark-nda-signed" action
   (IEC Office Demo Control — DrMorgan's order 2026-11-12: a
   manual Mark NDA signed for paper-signed agreements, e.g. a
   signer who returned a signed copy by email and never tripped
   the web signing flow).

   Runs the real handler against fixture copies of the MEDEXEC
   and CURAVIA provisioning stores, with fetch mocked for
   GitHub and Resend, and the Blob invites store on the
   in-memory mock. No real GitHub writes, no real emails.

   Covers: the happy path (record + provision + activation
   email), per-record isolation (one person/product marked —
   nothing else moves), 401 without a Desk session, the honest
   intermediate state when provisioning cannot run (asset key
   unset → NDA SIGNED, never a faked "invited"), activation
   email failure (account stands, emailed:false), validation,
   idempotent re-mark (provisioning retry, no duplicate entry),
   and the paper-first case (no invite record exists yet).

   Run: node scripts/demo-admin-mark-signed.test.mjs
   (exit 1 on any failure) */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = {
  medexec: fs.readFileSync(path.join(here, "../../medexec-site/demo/provisioning.js"), "utf8"),
  curavia: fs.readFileSync(path.join(here, "../../getcuravia-site/demo/provisioning.js"), "utf8")
};

/* ---------------- env ---------------- */
const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.DEMO_ADMIN_GITHUB_TOKEN_MEDEXEC = "gh-test-medexec";
process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA = "gh-test-curavia";
process.env.DEMO_ADMIN_RESEND_API_KEY = "resend-test";
process.env.BLOB_READ_WRITE_TOKEN = "blob-test";
/* InSnap / INSNAPP / IEC Docs Office keys deliberately UNSET:
   those assets stay configured:false and must be untouched. */

/* ---------------- mocked stores + fetch ---------------- */
const stores = {
  medexec: { source: FIXTURES.medexec, sha: "sha-m0", puts: 0, lastMessage: null },
  curavia: { source: FIXTURES.curavia, sha: "sha-c0", puts: 0, lastMessage: null }
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
  curavia: "https://api.github.com/repos/DrMorgan73/getcuravia-site/contents/demo/provisioning.js"
};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  for (const id of Object.keys(GH)) {
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
  }
  if (u === "https://api.resend.com/emails") {
    const body = JSON.parse(opts.body);
    sentEmails.push(body);
    /* A "bounce" recipient models a provider rejection (403). */
    if ((body.to || []).some(t => String(t).includes("bounce"))) {
      return jsonRes(403, { name: "validation_error", message: "mock provider rejection" });
    }
    return jsonRes(200, { id: `email-${sentEmails.length}` });
  }
  if (u.startsWith("https://blob.mock/")) {
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
const invitesStore = await import("../api/_demo-invites-store.js");

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

const ALICE = { email: "alice@example.com", name: "Alice Tester" };
const BOB = { email: "bob@example.com", name: "Bob Tester" };
const CAROL = { email: "carol@example.com", name: "Carol Paperfirst" };
const BOUNCE = { email: "bounce@example.com", name: "Bounce Tester" };

function matrixCell(listBody, email, asset) {
  const row = (listBody.matrix || []).find(r => r.email === email);
  return row ? row.cells[asset] : undefined;
}
function inviteOf(listBody, email, asset) {
  return (listBody.invites || []).find(i => i.email === email && i.asset === asset) || null;
}
function storeEntries(asset, email) {
  const matches = stores[asset].source.match(new RegExp(`email: "${email}"`, "g"));
  return matches ? matches.length : 0;
}

/* ================= auth ================= */
console.log("auth");
{
  const noCookie = await call({ action: "mark-nda-signed", asset: "medexec", email: ALICE.email }, null);
  ok(noCookie.status === 401 && noCookie.body.error === "unauthorized",
    "no Desk session cookie -> 401 unauthorized");
  const badSig = await call({ action: "mark-nda-signed", asset: "medexec", email: ALICE.email },
    "desk_session=drmorgan.9999999999.deadbeef");
  ok(badSig.status === 401, "forged session signature -> 401");
}

/* ================= setup: NDA-first invites ================= */
console.log("setup — invites land at nda_sent");
for (const [person, asset] of [[ALICE, "medexec"], [BOB, "medexec"], [ALICE, "curavia"], [BOUNCE, "medexec"]]) {
  const r = await call({ action: "invite", asset, email: person.email, name: person.name });
  ok(r.body.ok && r.body.state === "nda_sent", `invite ${person.email} -> ${asset} nda_sent`);
}
{
  const list = await call({ action: "list" });
  ok(matrixCell(list.body, ALICE.email, "medexec") === "nda_sent", "alice/medexec starts nda_sent");
  ok(matrixCell(list.body, ALICE.email, "curavia") === "nda_sent", "alice/curavia starts nda_sent");
  ok(matrixCell(list.body, BOB.email, "medexec") === "nda_sent", "bob/medexec starts nda_sent");
}

/* ================= happy path ================= */
console.log("happy path — mark alice/medexec signed");
const aliceMedexecBefore = stores.medexec.source;
{
  const r = await call({
    action: "mark-nda-signed", asset: "medexec",
    email: ALICE.email, name: ALICE.name, signedDate: "2026-11-11"
    /* basis omitted -> the default text */
  });
  ok(r.status === 200 && r.body.ok === true, "mark-signed answers 200 ok");
  ok(r.body.ndaSigned === true && r.body.alreadySigned === false, "first mark: ndaSigned, not alreadySigned");
  ok(r.body.state === "invited", "state invited once provisioning lands");
  ok(r.body.provisioning === "provisioned", "provisioning outcome: provisioned");
  ok(r.body.emailed === true, "activation email sent");
  ok(r.body.signedDate === "2026-11-11", "signed date recorded from the paper");
  ok(r.body.basis === "Paper agreement — verified by IEC", "default basis text applied");
  ok(r.body.markedBy === "drmorgan", "markedBy is the Desk session operator");
  ok(storeEntries("medexec", ALICE.email) === 1, "exactly one provisioning entry created");
  ok(/token: "[0-9a-f]{48}"/.test(stores.medexec.source.slice(stores.medexec.source.indexOf(ALICE.email))),
    "the new entry carries a fresh 48-hex token");
  ok(stores.medexec.lastMessage.includes("marked signed"), "store commit message names the paper path");
  const act = sentEmails.filter(m => (m.to || []).includes(ALICE.email) &&
    String(m.subject || "").includes("MEDEXEC") && String(m.subject || "").includes("activate"));
  ok(act.length === 1, "one MEDEXEC activation email sent to alice");
  ok(act.length && act[0].text.includes("https://getmedexec.com/demo/activate/?token="),
    "activation email carries the MEDEXEC activation link");

  const list = await call({ action: "list" });
  ok(matrixCell(list.body, ALICE.email, "medexec") === "invited", "matrix: alice/medexec now invited");
  const inv = inviteOf(list.body, ALICE.email, "medexec");
  ok(inv && inv.status === "nda_signed", "list exposes the invite record as nda_signed");
  ok(inv && inv.signedDate === "2026-11-11" && inv.markedBy === "drmorgan" && !!inv.markedAt,
    "list exposes signedDate / markedBy / markedAt");
  ok(inv && inv.signedBasis === "Paper agreement — verified by IEC", "list exposes the basis");
}

/* ================= per-record isolation ================= */
console.log("isolation — nothing else moved");
{
  const list = await call({ action: "list" });
  ok(matrixCell(list.body, BOB.email, "medexec") === "nda_sent", "bob/medexec still nda_sent");
  ok(matrixCell(list.body, ALICE.email, "curavia") === "nda_sent", "alice/curavia still nda_sent (other product untouched)");
  ok(storeEntries("medexec", BOB.email) === 0, "no provisioning entry for bob");
  ok(storeEntries("curavia", ALICE.email) === 0, "no curavia entry for alice");
  const bobInv = inviteOf(list.body, BOB.email, "medexec");
  ok(bobInv && bobInv.status === "nda_sent" && bobInv.signedDate === null && bobInv.markedBy === null,
    "bob's invite record carries no signed fields");
  const records = await invitesStore.readInvites();
  const bobRec = invitesStore.findInvite(records, BOB.email, "medexec");
  ok(bobRec && bobRec.status === "nda_sent" && !("signedDate" in bobRec),
    "stored record for bob is byte-honest: no signed fields at all");
  const aliceCur = invitesStore.findInvite(records, ALICE.email, "curavia");
  ok(aliceCur && aliceCur.status === "nda_sent", "stored alice/curavia record still nda_sent");
}

/* ================= idempotent re-mark ================= */
console.log("re-mark — provisioning retry, no duplicates");
{
  const emailsBefore = sentEmails.length;
  const r = await call({
    action: "mark-nda-signed", asset: "medexec",
    email: ALICE.email, name: ALICE.name, signedDate: "2026-11-11"
  });
  ok(r.body.ok && r.body.alreadySigned === true, "second mark reports alreadySigned");
  ok(r.body.provisioning === "already_provisioned" && r.body.state === "invited",
    "second mark: already provisioned, state stands");
  ok(r.body.emailed === null, "second mark sends no email (emailed null)");
  ok(storeEntries("medexec", ALICE.email) === 1, "still exactly one entry for alice");
  ok(sentEmails.length === emailsBefore, "no second activation email went out");
  const list = await call({ action: "list" });
  ok(matrixCell(list.body, ALICE.email, "medexec") === "invited", "matrix still invited after re-mark");
}

/* ================= activation email failure ================= */
console.log("email failure — account stands, failure reported");
{
  const r = await call({
    action: "mark-nda-signed", asset: "medexec",
    email: BOUNCE.email, name: BOUNCE.name, signedDate: "2026-11-10", basis: "Paper CNDA — verified by IEC"
  });
  ok(r.body.ok && r.body.provisioning === "provisioned", "bounce: entry still provisioned");
  ok(r.body.emailed === false && r.body.reason === "resend_403",
    "bounce: emailed:false with the provider reason — never hidden");
  ok(r.body.state === "invited", "bounce: state invited (the account exists; Resend can re-send the link)");
  ok(storeEntries("medexec", BOUNCE.email) === 1, "bounce: exactly one entry");
  const list = await call({ action: "list" });
  const inv = inviteOf(list.body, BOUNCE.email, "medexec");
  ok(inv && inv.status === "nda_signed" && inv.signedBasis === "Paper CNDA — verified by IEC",
    "bounce: custom basis recorded verbatim");
}

/* ================= honest intermediate state ================= */
console.log("honest intermediate — asset key unset, provisioning cannot run");
{
  const savedToken = process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA;
  delete process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA;
  const curaviaBefore = stores.curavia.source;
  const r = await call({
    action: "mark-nda-signed", asset: "curavia",
    email: ALICE.email, name: ALICE.name, signedDate: "2026-11-11"
  });
  ok(r.status === 200 && r.body.ok === true, "mark still succeeds — the attestation does not depend on the asset key");
  ok(r.body.state === "nda_signed", "state is nda_signed — NOT a faked invited");
  ok(r.body.provisioning === "not_configured" && r.body.reason === "asset_not_configured",
    "provisioning outcome + reason reported honestly");
  ok(r.body.emailed === null, "no email claimed");
  ok(stores.curavia.source === curaviaBefore && stores.curavia.puts === 0,
    "curavia store untouched while its key is unset");
  ok(storeEntries("curavia", ALICE.email) === 0, "no curavia entry exists for alice");

  /* The matrix derives alice/curavia from the invite record now:
     serve the list with the key still unset (asset reported
     not-configured, cell derived from the record). */
  const list = await call({ action: "list" });
  const inv = inviteOf(list.body, ALICE.email, "curavia");
  ok(inv && inv.status === "nda_signed", "list exposes alice/curavia as nda_signed");
  const X = mod._internals;
  const matrix = X.buildMatrix({ medexec: [], curavia: [] },
    [{ email: ALICE.email, name: ALICE.name, asset: "curavia", status: "nda_signed" }]);
  const row = matrix.find(x => x.email === ALICE.email);
  ok(row && row.cells.curavia === "nda_signed", "buildMatrix renders an nda_signed cell from the record alone");
  process.env.DEMO_ADMIN_GITHUB_TOKEN_CURAVIA = savedToken;

  /* ... and the retry with the key restored provisions for real. */
  const retry = await call({
    action: "mark-nda-signed", asset: "curavia",
    email: ALICE.email, name: ALICE.name, signedDate: "2026-11-11"
  });
  ok(retry.body.alreadySigned === true && retry.body.provisioning === "provisioned" && retry.body.state === "invited",
    "retry after key restore: provisions, state invited");
  ok(storeEntries("curavia", ALICE.email) === 1, "retry created exactly one curavia entry");
  const list2 = await call({ action: "list" });
  ok(matrixCell(list2.body, ALICE.email, "curavia") === "invited", "matrix: alice/curavia invited after retry");
}

/* ================= paper-first (no invite record) ================= */
console.log("paper-first — no invite record exists yet");
{
  ok(inviteOf((await call({ action: "list" })).body, CAROL.email, "medexec") === null,
    "carol has no invite record before the mark");
  const r = await call({
    action: "mark-nda-signed", asset: "medexec",
    email: CAROL.email, name: CAROL.name, signedDate: "2026-11-09"
  });
  ok(r.body.ok && r.body.provisioning === "provisioned" && r.body.state === "invited",
    "paper-first mark provisions");
  const records = await invitesStore.readInvites();
  const rec = invitesStore.findInvite(records, CAROL.email, "medexec");
  ok(rec && rec.status === "nda_signed" && rec.sends === 0 && rec.sentAt === null,
    "created record is honest: signed state, zero sends, no sent timestamp");
  ok(rec && rec.name === CAROL.name && rec.signedDate === "2026-11-09",
    "created record carries the name and the paper date");
}

/* ================= validation ================= */
console.log("validation");
{
  const badDate = await call({ action: "mark-nda-signed", asset: "medexec", email: BOB.email, signedDate: "11/11/2026" });
  ok(badDate.status === 400 && badDate.body.error === "invalid_signed_date", "non-ISO signedDate -> 400");
  const fakeDate = await call({ action: "mark-nda-signed", asset: "medexec", email: BOB.email, signedDate: "2026-02-31" });
  ok(fakeDate.status === 400 && fakeDate.body.error === "invalid_signed_date", "impossible calendar date -> 400");
  const badEmail = await call({ action: "mark-nda-signed", asset: "medexec", email: "not-an-email" });
  ok(badEmail.status === 400 && badEmail.body.error === "invalid_email", "implausible email -> 400");
  const badAsset = await call({ action: "mark-nda-signed", asset: "nope", email: BOB.email });
  ok(badAsset.status === 400 && badAsset.body.error === "unknown_asset", "unknown asset -> 400");
  const list = await call({ action: "list" });
  ok(matrixCell(list.body, BOB.email, "medexec") === "nda_sent",
    "failed validations changed nothing — bob still nda_sent");
  ok(storeEntries("medexec", BOB.email) === 0, "failed validations created no entry");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
