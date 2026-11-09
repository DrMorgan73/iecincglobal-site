/* Local test suite for api/_demo-invites-store.js (IEC Office Demo
   NDA-invite store).

   Covers the 2026-11-09 fixes:
   1. THE LOST-RECORD RACE: the store's document lives behind a
      public Blob URL, which is CDN-cached. This suite simulates
      the CDN faithfully — a fetch of the BARE url serves the
      first-seen snapshot forever (stale), a fetch with the store's
      cache-busting query reaches the live content — and then runs
      the Desk's real flow: rapid SEQUENTIAL per-asset invites for
      one person (MEDEXEC, CURAVIA, INSNAPP seconds apart, exactly
      the sequence that lost the MEDEXEC record for
      mzaza@va-hcs.com on 2026-11-09). Every record must survive.
      Under the pre-fix read pattern each upsert would have built
      on the stale empty snapshot and only the last record would
      remain.
   2. Delivery status: stampNdaInviteEmail / touchNdaInvite with an
      outcome persist lastEmailStatus / lastEmailReason /
      lastEmailAt; failures are recorded, not just successes.
   3. Legacy records (written before delivery status existed)
      keep working.

   Run: node scripts/demo-invites-store.test.mjs   (exit 1 on failure) */

import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";

/* ---------------- fetch mock with a simulated CDN ---------------- */
/* bare URL  -> the first snapshot ever served (the edge copy)
   ?cb=...   -> the live document (cache-busted reads reach origin) */
const cdnSnapshots = new Map();
const fetches = [];
/* One-shot read-after-write propagation lag: when armed for the
   Nth cache-busted read, that read serves a stale text once —
   the behaviour the live Blob store showed on 2026-11-09 (a
   verify read right after a successful put still served the
   pre-write document). */
let bustedReads = 0;
let lagArm = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  fetches.push(u);
  if (!u.startsWith("https://blob.mock/")) throw new Error(`unmocked fetch: ${u}`);
  const bare = u.split("?")[0];
  const qs = u.slice(bare.length + 1);
  const rec = [...blobMock.__blobs.values()].find(r => r.url === bare);
  if (!rec) return { ok: false, status: 404, text: async () => "" };
  if (!qs.includes("cb=")) {
    if (!cdnSnapshots.has(bare)) cdnSnapshots.set(bare, rec.content);
    const snap = cdnSnapshots.get(bare);
    return { ok: true, status: 200, text: async () => snap };
  }
  bustedReads++;
  if (lagArm && bustedReads === lagArm.at) {
    const text = lagArm.text;
    lagArm = null;
    return { ok: true, status: 200, text: async () => text };
  }
  return { ok: true, status: 200, text: async () => rec.content };
};

const store = await import("../api/_demo-invites-store.js");

/* ---------------- tiny harness ---------------- */
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

async function seedDoc(text) {
  blobMock.__reset();
  cdnSnapshots.clear();
  await blobMock.put(store.INVITES_PATHNAME, text, {
    access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json"
  });
}

/* ---------------- 1. the lost-record race ---------------- */
console.log("lost-record race (sequential multi-asset invites, stale CDN)");
await seedDoc("[]");
/* DrMorgan opens the Demo Users page: the bare URL is fetched once
   and the (empty) document is now the CDN edge copy. */
await fetch("https://blob.mock/demo-invites.json");

const t0 = new Date("2026-11-09T20:14:15.000Z");
await store.upsertNdaInvite({ email: "mzaza@va-hcs.com", name: "Mohamed Zaza", asset: "medexec" }, t0);
await store.upsertNdaInvite({ email: "mzaza@va-hcs.com", name: "Mohamed Zaza", asset: "curavia" },
  new Date("2026-11-09T20:14:45.000Z"));
await store.upsertNdaInvite({ email: "mzaza@va-hcs.com", name: "Mohamed Zaza", asset: "insnapp" },
  new Date("2026-11-09T20:15:05.000Z"));

let all = await store.readInvites();
ok(all.length === 3, "all three sequential invites survive (MEDEXEC + CURAVIA + INSNAPP)");
ok(["medexec", "curavia", "insnapp"].every(a => all.some(r => r.asset === a && r.email === "mzaza@va-hcs.com")),
  "one record per asset for the same person");

/* Every document read the store made carried the cache-buster
   (fetches[0] is this test's own page-load fetch; the stale probe
   below is excluded by the window end). */
const storeFetchWindow = fetches.slice(1);
ok(storeFetchWindow.length > 0 && storeFetchWindow.every(u => u.includes("cb=")),
  "every store read is cache-busted (fresh)");

/* The simulation really is armed: the bare URL still serves the
   stale empty document — the pre-fix read pattern would have
   clobbered down to a single record. */
const stale = await (await fetch("https://blob.mock/demo-invites.json")).text();
ok(stale === "[]", "the bare (pre-fix) URL still serves the stale empty snapshot — the race is reproduced in the harness");

/* A second person, interleaved with a repeat invite, also holds. */
await store.upsertNdaInvite({ email: "other@example.com", name: "Other Person", asset: "medexec" }, t0);
await store.upsertNdaInvite({ email: "mzaza@va-hcs.com", name: "Mohamed Zaza", asset: "medexec" },
  new Date("2026-11-09T20:16:00.000Z"));
all = await store.readInvites();
ok(all.length === 4, "a second person's record joins without loss");
const mzMed = all.find(r => r.email === "mzaza@va-hcs.com" && r.asset === "medexec");
ok(mzMed.sends === 2 && mzMed.sentAt === t0.toISOString(),
  "repeat invite: original sentAt kept, sends bumped");

/* ---------------- 2. delivery status ---------------- */
console.log("delivery status (lastEmailStatus / lastEmailReason / lastEmailAt)");
let rec = await store.stampNdaInviteEmail("mzaza@va-hcs.com", "medexec",
  { sent: false, reason: "resend_403" }, new Date("2026-11-09T20:20:00.000Z"));
ok(!!rec && rec.lastEmailStatus === "failed" && rec.lastEmailReason === "resend_403" &&
   rec.lastEmailAt === "2026-11-09T20:20:00.000Z",
  "a failed invite send is stamped with status + reason + time");
ok(rec.sends === 2, "stamping does not double-count the attempt");
all = await store.readInvites();
ok(all.find(r => r.email === "mzaza@va-hcs.com" && r.asset === "medexec").lastEmailStatus === "failed",
  "the failure persists in the stored document");

rec = await store.touchNdaInvite("mzaza@va-hcs.com", "medexec",
  new Date("2026-11-09T20:25:00.000Z"), { sent: true, id: "email-9" });
ok(!!rec && rec.lastEmailStatus === "sent" && rec.lastEmailReason === null && rec.sends === 3 &&
   rec.lastSentAt === "2026-11-09T20:25:00.000Z",
  "a successful resend flips the stamp to sent and counts the attempt");

rec = await store.touchNdaInvite("mzaza@va-hcs.com", "curavia",
  new Date("2026-11-09T20:26:00.000Z"), { sent: false, reason: "resend_403" });
ok(!!rec && rec.lastEmailStatus === "failed" && rec.sends === 2,
  "a FAILED resend is stamped and counted too");

ok(await store.stampNdaInviteEmail("ghost@example.com", "medexec", { sent: true }) === null,
  "stamp on a missing record returns null");
ok(await store.touchNdaInvite("ghost@example.com", "medexec") === null,
  "touch on a missing record returns null");
all = await store.readInvites();
ok(all.length === 4, "no phantom records were created by stamping");

/* ---------------- 3. legacy records ---------------- */
console.log("legacy records (no delivery-status fields)");
await seedDoc(JSON.stringify([{
  email: "legacy@example.com", name: "Legacy Person", asset: "curavia",
  status: "nda_sent", sentAt: "2026-11-05T10:00:00.000Z", lastSentAt: "2026-11-05T10:00:00.000Z", sends: 1
}]));
rec = await store.upsertNdaInvite({ email: "legacy@example.com", name: "Legacy Person", asset: "curavia" },
  new Date("2026-11-09T21:00:00.000Z"));
ok(rec.sends === 2 && rec.sentAt === "2026-11-05T10:00:00.000Z",
  "legacy record: repeat invite keeps sentAt, bumps sends");
rec = await store.stampNdaInviteEmail("legacy@example.com", "curavia",
  { sent: false, reason: "not_configured" }, new Date("2026-11-09T21:01:00.000Z"));
ok(!!rec && rec.lastEmailStatus === "failed",
  "legacy record gains delivery-status fields on its first stamp");

/* ---------------- 4. read-after-write propagation lag ---------------- */
console.log("propagation lag (first verify read serves the pre-write doc)");
await seedDoc("[]");
const baseReads = bustedReads;
/* The upsert reads fresh (busted read #base+1), writes, then
   verifies (busted read #base+2) — arm the lag on the verify. */
lagArm = { at: baseReads + 2, text: "[]" };
rec = await store.upsertNdaInvite({ email: "lag@example.com", name: "Lag Person", asset: "medexec" },
  new Date("2026-11-09T21:05:00.000Z"));
ok(!!rec && rec.email === "lag@example.com",
  "the upsert still succeeds — the verify retry outlasts the lag");
ok(bustedReads - baseReads >= 3,
  "the store re-read after the lagged verify (retry engaged, not a silent pass)");
all = await store.readInvites();
ok(all.length === 1 && all[0].email === "lag@example.com",
  "the record is really stored once the lag clears");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
