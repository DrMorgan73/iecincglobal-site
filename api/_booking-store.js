/* =====================================================================
   IEC — "Book a call" booking store (shared helper; the leading
   underscore keeps Vercel from routing it as a function, the same
   convention as api/_questionnaire-store.js).

   STORAGE DESIGN — two layers in the Office Blob store, because
   this platform's reads are eventually consistent in ways that
   matter here (all verified live, 2026-11-17):

   1. AUTHORITATIVE — one immutable file per booking:
        bookings/by-slot/<date>T<time>.json
      The file IS the slot claim: it is written with
      allowOverwrite:false, so the storage service itself refuses
      a second write for a taken slot, atomically, at write time.
      Double-booking protection therefore never depends on a
      read being fresh. Reads list these files and get() each
      one from origin (useCache:false); their content never
      changes after the write, so a cached copy is a correct
      copy. Cancellation deletes the file.

   2. LEDGER — bookings.json, ONE JSON document holding every
      booking, appended read-modify-write exactly like the
      questionnaire's questionnaire-submissions.json
      (api/_questionnaire-store.js). This is the human-readable
      record the office can open. It is a MIRROR: appended
      best-effort after the slot claim succeeds. Nothing in the
      booking flow reads it back — availability, existence and
      cancellation all read layer 1.

   Why not read bookings.json like the questionnaire store does?
   The document's public URL is CDN-served with a 30-day cache
   header keyed on the path alone, and even origin reads via
   get(useCache:false) trail a write by ~15 seconds (measured
   live). On that pattern a cancelled slot stayed "taken" on
   stale reads, and — the dangerous direction — a duplicate
   booking was accepted when its conflict check read a
   pre-booking copy. The questionnaire can live with it (its
   system of record is a database; the Blob copy is a backup).
   A booking store cannot: its conflict check IS the product.

   Reads/writes of layer 1 THROW on transport failure: the
   endpoint must know when a booking could not be stored.
   Configuration is checked first via bookingsConfigured(); the
   endpoint answers 503 when it is false.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             questionnaire submissions use)
   ===================================================================== */

import { put, get, list, del } from "@vercel/blob";

export const BOOKINGS_PATHNAME = "bookings.json";
export const BY_SLOT_PREFIX = "bookings/by-slot/";

export function bookingsConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

const bySlotPath = (date, time) => `${BY_SLOT_PREFIX}${date}T${time}.json`;

async function readJsonBlob(pathname) {
  const result = await get(pathname, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  try {
    return JSON.parse(await new Response(result.stream).text());
  } catch (e) {
    return null;
  }
}

function usableRecord(x) {
  return x && typeof x === "object" && x.id && x.date && x.time;
}

/* Every booking file with its store location, read from origin.
   Throws only on Blob transport errors. */
async function readBookingFiles() {
  const { blobs } = await list({ prefix: BY_SLOT_PREFIX });
  const files = [];
  for (const b of blobs) {
    if (!b.pathname.endsWith(".json")) continue;
    const record = await readJsonBlob(b.pathname);
    if (usableRecord(record)) {
      files.push({ record, pathname: b.pathname, url: b.url });
    }
  }
  files.sort((a, b2) =>
    `${a.record.date}T${a.record.time}`.localeCompare(`${b2.record.date}T${b2.record.time}`)
  );
  return files;
}

/* All current bookings (authoritative layer), oldest slot first. */
export async function readBookings() {
  const files = await readBookingFiles();
  return files.map(f => f.record);
}

export function slotTaken(records, date, time) {
  return records.some(b => b.date === date && b.time === time && b.status !== "cancelled");
}

/* ------------------------------------------------------------------ */
/* Ledger mirror (bookings.json) — best-effort, never read back        */
/* ------------------------------------------------------------------ */

async function appendToLedger(record) {
  const parsed = await readJsonBlob(BOOKINGS_PATHNAME);
  const records = Array.isArray(parsed) ? parsed.filter(usableRecord) : [];
  records.push(record);
  await put(BOOKINGS_PATHNAME, JSON.stringify(records, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

async function removeFromLedger(id) {
  const parsed = await readJsonBlob(BOOKINGS_PATHNAME);
  if (!Array.isArray(parsed)) return;
  const records = parsed.filter(x => !(x && x.id === id));
  if (records.length === parsed.length) return;
  await put(BOOKINGS_PATHNAME, JSON.stringify(records, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/* Claim a slot and store its booking. The claim is the write of
   the by-slot file with allowOverwrite:false — refused by the
   storage service itself when the slot is taken, whatever any
   read anywhere last saw. Returns { ok:true, record } or
   { ok:false, conflict:true }. Throws on transport failure. */
export async function tryAppendBooking(record) {
  try {
    await put(bySlotPath(record.date, record.time), JSON.stringify(record, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json"
    });
  } catch (e) {
    if (e && /already exists/i.test(String(e.message || ""))) {
      return { ok: false, conflict: true };
    }
    throw e;
  }
  try {
    await appendToLedger(record);
  } catch (e) {
    console.error(`[book-store] ledger append FAILED for ${record.id}: ${e && e.message}`);
  }
  return { ok: true, record };
}

export async function findBooking(id) {
  const files = await readBookingFiles();
  const hit = files.find(f => f.record.id === id);
  return hit ? hit.record : null;
}

/* Remove one booking, only when the caller's email matches the
   booker's — the self-service cancel a booking page owes its
   users (and the path used to remove labeled test bookings).
   Deletes the authoritative by-slot file, then mirrors the
   removal in the ledger. Returns the removed record, or null
   when nothing matched. Throws on transport failure. */
export async function removeBooking(id, email) {
  const target = String(email || "").trim().toLowerCase();
  const files = await readBookingFiles();
  const hit = files.find(
    f => f.record.id === id && String(f.record.email || "").trim().toLowerCase() === target
  );
  if (!hit) return null;
  await del(hit.url);
  try {
    await removeFromLedger(id);
  } catch (e) {
    console.error(`[book-store] ledger removal FAILED for ${id}: ${e && e.message}`);
  }
  return hit.record;
}
