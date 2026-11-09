/* =====================================================================
   IEC Office — Dana Opportunities store (shared helper; the leading
   underscore keeps Vercel from routing it as a function, the same
   convention as api/_dana-dashboard-store.js).

   Dana's opportunity pipeline lives in the Office Blob store as ONE
   JSON document, read-modify-write through @vercel/blob with the same
   pattern as the dashboard store:

     opportunities.json — [ { id, name, type, side, value, source,
                              contact, verdict, notes, added }, ... ]

   A missing document means "no saved pipeline yet" — the pipeline is
   genuinely empty until DrMorgan adds to it; nothing is ever seeded.
   Reads/writes THROW on transport failure so the API can answer
   honestly instead of pretending a save landed.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             Desk documents, invites and activity use)
   ===================================================================== */

import { put, list } from "@vercel/blob";

export const OPPS_PATHNAME = "opportunities.json";

export function opportunitiesConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* The saved opportunities array, or null when none exists yet / the
   document holds nothing usable. Throws only on Blob transport
   errors. */
export async function readOpportunities() {
  const { blobs } = await list({ prefix: OPPS_PATHNAME });
  const hit = blobs.find(b => b.pathname === OPPS_PATHNAME);
  if (!hit) return null;
  const r = await fetch(hit.url);
  if (!r.ok) return null;
  try {
    const parsed = JSON.parse(await r.text());
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/* Persist the opportunities array exactly as given (the API sanitizes
   before calling). */
export async function writeOpportunities(opps) {
  await put(OPPS_PATHNAME, JSON.stringify(opps, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}
