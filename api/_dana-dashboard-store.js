/* =====================================================================
   IEC Office — Dana Follow-Up dashboard store (shared helper; the
   leading underscore keeps Vercel from routing it as a function, the
   same convention as api/_office-layout-store.js).

   The follow-up board's state — the decisions waiting on DrMorgan,
   the buyer pipeline Dana scouts, and her run log — lives in the
   Office Blob store as ONE JSON document, read-modify-write through
   @vercel/blob with the same pattern as the layout store:

     dana-dashboard.json — { decisions: [...], buyers: [...],
                             runs: [...], updatedAt: ISO string }

   A missing document (or a stored JSON null, which is what Reset
   writes) means "no saved board yet" — api/dana-dashboard.js then
   serves the seed board built from the target map of record.
   Reads/writes THROW on transport failure so the API can answer
   honestly instead of pretending a save landed.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             Desk documents, invites and activity use)
   ===================================================================== */

import { put, list } from "@vercel/blob";

export const DANA_PATHNAME = "dana-dashboard.json";

export function dashboardConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* The saved board state, or null when none exists yet / the document
   holds nothing usable. Throws only on Blob transport errors. */
export async function readDashboard() {
  const { blobs } = await list({ prefix: DANA_PATHNAME });
  const hit = blobs.find(b => b.pathname === DANA_PATHNAME);
  if (!hit) return null;
  const r = await fetch(hit.url);
  if (!r.ok) return null;
  try {
    const parsed = JSON.parse(await r.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/* Persist the board state (or null, for Reset — stored as the JSON
   literal null so readDashboard reports "no saved board"). */
export async function writeDashboard(state) {
  await put(DANA_PATHNAME, JSON.stringify(state, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}
