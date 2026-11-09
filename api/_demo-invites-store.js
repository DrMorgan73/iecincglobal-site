/* =====================================================================
   IEC Office — Demo NDA-invite store (shared helper; the leading
   underscore keeps Vercel from routing it as a function, the same
   convention as api/_demo-activity-store.js).

   NDA-FIRST INVITES (DrMorgan's standing rule, 2026-11-05): an
   Office demo invitation no longer provisions an account directly.
   It (1) records the person here in the pre-state "nda_sent" and
   (2) emails the asset's confidentiality agreement to sign. The
   account itself is created later, by the asset side, once the NDA
   is executed — the website signing trigger (MEDEXEC, InSnap) or
   the verified-countersignature flow — and from that moment the
   asset's own provisioning store is the source of truth and the
   matrix cell shows the provisioning state instead.

   Records live in the Office Blob store as ONE JSON document,
   read-modify-write through @vercel/blob with the read pattern of
   api/yt-archive.js's job store:

     demo-invites.json — [ { email, name, asset, status: "nda_sent",
                             sentAt, lastSentAt, sends,
                             lastEmailStatus, lastEmailReason,
                             lastEmailAt } ]

   DELIVERY STATUS (2026-11-09): every NDA email attempt — invite
   or resend, success or failure — stamps its outcome on the
   record (lastEmailStatus "sent" | "failed", lastEmailReason,
   lastEmailAt) so a failed send stays visible on the matrix
   instead of living only in the transient invite response.

   LOST-RECORD RACE — FIXED 2026-11-09: the original read fetched
   the document through its public Blob URL, which is CDN-cached.
   After an overwrite the edge could keep serving the PREVIOUS
   document, so the Desk's sequential per-asset invites for one
   person (MEDEXEC, then CURAVIA seconds later) each read a stale
   base and the second whole-document write clobbered the first —
   a real MEDEXEC invite record was lost exactly this way. Two
   defences now apply:
     1. FRESH READS: every read appends a unique cache-busting
        query string (a new CDN cache key, so the read reaches
        the origin) and passes cache:"no-store". The Desk flow is
        sequential per person, so a fresh base makes each upsert
        build on the previous write — loss-free by construction.
     2. WRITE-THEN-VERIFY: each write is re-read (fresh) and
        checked — every record that existed before the write and
        every record in the candidate must be present, and the
        mutated record must match what was written. A mismatch
        (a clobber from a writer working off an older lineage)
        triggers a merge-repair: union of the stored document and
        the candidate, the mutated record winning its own key,
        then write + verify again. If the write still has not
        landed after all attempts, the store THROWS — a loud
        failure the caller surfaces, never a silent loss.
   Truly simultaneous writers with disjoint bases remain
   last-writer-wins between their verify windows; no code path in
   the portal writes this document concurrently (the Desk flow
   awaits each invite in turn), and records are never deleted.

   Unlike the activity store, reads/writes here THROW on transport
   failure: the record is the invite's state, so demo-admin must
   know when it could not be written (record first — if the record
   fails, no NDA email goes out). Configuration is checked first via
   invitesConfigured(); callers answer 503 when it is false.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             Desk documents and activity use)
   ===================================================================== */

import { put, list } from "@vercel/blob";

export const INVITES_PATHNAME = "demo-invites.json";

/* Initial write + merge-repair retries before a write is declared
   unverified and thrown. */
const WRITE_ATTEMPTS = 4;

export function invitesConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* A per-read unique query string: a different CDN cache key, so
   the fetch reaches the origin instead of a stale edge copy. */
function freshUrl(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function parseInvitesDoc(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(x => x && typeof x === "object" && x.email && x.asset);
  } catch (e) {
    return [];
  }
}

/* The whole invites document, read FRESH (see the header: the
   public URL is CDN-cached, so the read cache-busts). [] when it
   does not exist yet or holds nothing usable. Throws only on Blob
   transport errors. */
export async function readInvites() {
  const { blobs } = await list({ prefix: INVITES_PATHNAME });
  const hit = blobs.find(b => b.pathname === INVITES_PATHNAME);
  if (!hit) return [];
  const r = await fetch(freshUrl(hit.url), { cache: "no-store" });
  if (!r.ok) return [];
  return parseInvitesDoc(await r.text());
}

async function writeInvitesDoc(records) {
  await put(INVITES_PATHNAME, JSON.stringify(records, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

export function findInvite(records, email, assetId) {
  return records.find(x => x.email === email && x.asset === assetId) || null;
}

const keyOf = r => `${String(r.email || "").toLowerCase()}|${r.asset}`;

/* The fields a mutation must see intact on its own record after
   the write: the send counters/timestamps it set, and — when the
   mutation stamped one — the email outcome. */
function recordMatches(stored, intended) {
  if (!stored || !intended) return false;
  if (stored.lastSentAt !== intended.lastSentAt) return false;
  if ((stored.sends || 1) !== (intended.sends || 1)) return false;
  if ("lastEmailStatus" in intended && intended.lastEmailStatus !== null &&
      stored.lastEmailStatus !== intended.lastEmailStatus) return false;
  if ("lastEmailAt" in intended && intended.lastEmailAt &&
      stored.lastEmailAt !== intended.lastEmailAt) return false;
  return true;
}

/* Did the write land whole? Every record that existed before the
   write and every record in the candidate must be present, and
   the mutated record must match what was written. */
function writeLanded(before, candidate, stored, target) {
  const storedByKey = new Map(stored.map(r => [keyOf(r), r]));
  for (const r of before) if (!storedByKey.has(keyOf(r))) return false;
  for (const r of candidate) if (!storedByKey.has(keyOf(r))) return false;
  if (target && !recordMatches(storedByKey.get(keyOf(target)), target)) return false;
  return true;
}

/* Union of two documents by (email, asset). The target key (the
   record this write mutates) takes the candidate's version; for
   any other shared key the later lastSentAt wins, then the higher
   sends count — the union only ever ADDS records back, it never
   drops one. */
function mergeRecords(stored, candidate, targetKey) {
  const byKey = new Map();
  for (const r of stored) byKey.set(keyOf(r), r);
  for (const r of candidate) {
    const k = keyOf(r);
    const cur = byKey.get(k);
    if (!cur || k === targetKey) { byKey.set(k, r); continue; }
    const later = String(r.lastSentAt || "") > String(cur.lastSentAt || "");
    const moreSends = (r.sends || 1) > (cur.sends || 1);
    if (later || (String(r.lastSentAt || "") === String(cur.lastSentAt || "") && moreSends)) {
      byKey.set(k, r);
    }
  }
  return [...byKey.values()];
}

/* Write the candidate document, then verify it landed whole
   (fresh re-read). On a mismatch, merge-repair against whatever
   is actually stored and try again. Throws after WRITE_ATTEMPTS
   unverified writes — loud, never silently lossy. */
async function commitInvites(before, candidate, target) {
  let next = candidate;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    await writeInvitesDoc(next);
    const stored = await readInvites();
    if (writeLanded(before, next, stored, target)) return stored;
    console.error(
      `[demo-invites] write verification failed (attempt ${attempt + 1}/${WRITE_ATTEMPTS}) — merge-repairing against the stored document.`
    );
    next = mergeRecords(stored, next, target ? keyOf(target) : null);
    /* Nothing from the pre-write document may vanish either. */
    for (const r of before) {
      if (!next.some(x => keyOf(x) === keyOf(r))) next.push(r);
    }
  }
  throw new Error("invites_write_unverified");
}

/* Record (or refresh) an nda_sent invite. A repeat invite keeps the
   original sentAt and bumps sends / lastSentAt — the matrix cares
   that an NDA is outstanding, the counts are the audit trail.
   Returns the stored record. Throws on transport failure or when
   the write cannot be verified. */
export async function upsertNdaInvite({ email, name, asset }, now = new Date()) {
  const before = await readInvites();
  const ts = now.toISOString();
  const candidate = before.map(r => ({ ...r }));
  let target = findInvite(candidate, email, asset);
  if (target) {
    if (name) target.name = name;
    target.lastSentAt = ts;
    target.sends = (target.sends || 1) + 1;
  } else {
    target = {
      email,
      name: name || "",
      asset,
      status: "nda_sent",
      sentAt: ts,
      lastSentAt: ts,
      sends: 1,
      lastEmailStatus: null,
      lastEmailReason: null,
      lastEmailAt: null
    };
    candidate.push(target);
  }
  await commitInvites(before, candidate, target);
  return target;
}

function applyEmailOutcome(record, outcome, now) {
  const sent = !!(outcome && outcome.sent);
  record.lastEmailStatus = sent ? "sent" : "failed";
  record.lastEmailReason = sent ? null : String((outcome && outcome.reason) || "send_failed");
  record.lastEmailAt = (now instanceof Date ? now : new Date(now)).toISOString();
}

/* Stamp the outcome of an NDA email attempt on an existing record
   WITHOUT touching the send counters (the invite path: upsertNda-
   Invite already counted this attempt). Returns the record, or
   null when none exists. Throws on transport failure. */
export async function stampNdaInviteEmail(email, assetId, outcome, now = new Date()) {
  const before = await readInvites();
  const candidate = before.map(r => ({ ...r }));
  const existing = findInvite(candidate, email, assetId);
  if (!existing) return null;
  applyEmailOutcome(existing, outcome, now);
  await commitInvites(before, candidate, existing);
  return existing;
}

/* Stamp a re-send of the NDA email on an existing record (the
   resend action): bumps sends / lastSentAt and, when the caller
   passes the send outcome, stamps it too — failed resends are
   recorded, not just successful ones. Returns the record, or null
   when none exists. Throws on transport failure. */
export async function touchNdaInvite(email, assetId, now = new Date(), outcome = null) {
  const before = await readInvites();
  const candidate = before.map(r => ({ ...r }));
  const existing = findInvite(candidate, email, assetId);
  if (!existing) return null;
  existing.lastSentAt = now.toISOString();
  existing.sends = (existing.sends || 1) + 1;
  if (outcome) applyEmailOutcome(existing, outcome, now);
  await commitInvites(before, candidate, existing);
  return existing;
}
