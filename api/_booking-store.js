/* =====================================================================
   IEC — "Book a call" booking store (shared helper; the leading
   underscore keeps Vercel from routing it as a function, the same
   convention as api/_questionnaire-store.js).

   Every confirmed booking from the public booking page
   (book.html → POST /api/book) is appended here as ONE JSON
   document in the Office Blob store, read-modify-write through
   @vercel/blob with exactly the pattern of
   api/_questionnaire-store.js:

     bookings.json —
       [ { id, receivedAt, date, time, startUtc, timezone,
           name, email, company, note, status } ]

   date/time are wall-clock in America/New_York (see
   api/_booking-slots.js); startUtc is the same instant in UTC.

   DOUBLE-BOOKING PROTECTION: tryAppendBooking re-reads the whole
   document immediately before writing and refuses when a booking
   for the same date+time is already present, so the check and the
   write run against the freshest state the store can offer.

   Reads/writes THROW on transport failure: the endpoint must know
   when a booking could not be stored. Configuration is checked
   first via bookingsConfigured(); the endpoint answers 503 when
   it is false.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             questionnaire submissions use)
   ===================================================================== */

import { put, list } from "@vercel/blob";

export const BOOKINGS_PATHNAME = "bookings.json";

export function bookingsConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* The whole bookings document. [] when it does not exist yet or
   holds nothing usable. Throws only on Blob transport errors. */
export async function readBookings() {
  const { blobs } = await list({ prefix: BOOKINGS_PATHNAME });
  const hit = blobs.find(b => b.pathname === BOOKINGS_PATHNAME);
  if (!hit) return [];
  const r = await fetch(hit.url);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(await r.text());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(x => x && typeof x === "object" && x.id && x.date && x.time);
  } catch (e) {
    return [];
  }
}

async function writeBookings(records) {
  await put(BOOKINGS_PATHNAME, JSON.stringify(records, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

export function slotTaken(records, date, time) {
  return records.some(b => b.date === date && b.time === time && b.status !== "cancelled");
}

/* Append one booking only if its slot is still free in the
   freshly re-read store. Returns { ok:true, record } or
   { ok:false, conflict:true }. Throws on transport failure. */
export async function tryAppendBooking(record) {
  const records = await readBookings();
  if (slotTaken(records, record.date, record.time)) {
    return { ok: false, conflict: true };
  }
  records.push(record);
  await writeBookings(records);
  return { ok: true, record };
}

export async function findBooking(id) {
  const records = await readBookings();
  return records.find(x => x.id === id) || null;
}

/* Remove one booking, only when the caller's email matches the
   booker's — the self-service cancel a booking page owes its
   users (and the path used to remove labeled test bookings).
   Returns the removed record, or null when nothing matched.
   Throws on transport failure. */
export async function removeBooking(id, email) {
  const target = String(email || "").trim().toLowerCase();
  const records = await readBookings();
  const idx = records.findIndex(
    x => x.id === id && String(x.email || "").trim().toLowerCase() === target
  );
  if (idx < 0) return null;
  const [removed] = records.splice(idx, 1);
  await writeBookings(records);
  return removed;
}
