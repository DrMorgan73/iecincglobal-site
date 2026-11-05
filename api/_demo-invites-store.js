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
                             sentAt, lastSentAt, sends } ]

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

export function invitesConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* The whole invites document. [] when it does not exist yet or
   holds nothing usable. Throws only on Blob transport errors. */
export async function readInvites() {
  const { blobs } = await list({ prefix: INVITES_PATHNAME });
  const hit = blobs.find(b => b.pathname === INVITES_PATHNAME);
  if (!hit) return [];
  const r = await fetch(hit.url);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(await r.text());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(x => x && typeof x === "object" && x.email && x.asset);
  } catch (e) {
    return [];
  }
}

async function writeInvites(records) {
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

/* Record (or refresh) an nda_sent invite. A repeat invite keeps the
   original sentAt and bumps sends / lastSentAt — the matrix cares
   that an NDA is outstanding, the counts are the audit trail.
   Returns the stored record. Throws on transport failure. */
export async function upsertNdaInvite({ email, name, asset }, now = new Date()) {
  const records = await readInvites();
  const ts = now.toISOString();
  const existing = findInvite(records, email, asset);
  if (existing) {
    if (name) existing.name = name;
    existing.lastSentAt = ts;
    existing.sends = (existing.sends || 1) + 1;
    await writeInvites(records);
    return existing;
  }
  const record = {
    email,
    name: name || "",
    asset,
    status: "nda_sent",
    sentAt: ts,
    lastSentAt: ts,
    sends: 1
  };
  records.push(record);
  await writeInvites(records);
  return record;
}

/* Stamp a re-send of the NDA email on an existing record (the
   resend action). Returns the record, or null when none exists.
   Throws on transport failure. */
export async function touchNdaInvite(email, assetId, now = new Date()) {
  const records = await readInvites();
  const existing = findInvite(records, email, assetId);
  if (!existing) return null;
  existing.lastSentAt = now.toISOString();
  existing.sends = (existing.sends || 1) + 1;
  await writeInvites(records);
  return existing;
}
