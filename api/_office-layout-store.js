/* =====================================================================
   IEC Office — "My Office" layout store (shared helper; the leading
   underscore keeps Vercel from routing it as a function, the same
   convention as api/_demo-invites-store.js).

   DrMorgan's personal Office arrangement — the order of the Desk
   modules and which ones are hidden from his home view — lives in
   the Office Blob store as ONE JSON document, read-modify-write
   through @vercel/blob with the same pattern as the invites store:

     office-layout.json — { order: [moduleId, ...],
                            hidden: [moduleId, ...],
                            updatedAt: ISO string }

   A missing document (or a stored JSON null, which is what Reset
   writes) means "no saved layout" — every surface renders the
   default arrangement. Reads/writes THROW on transport failure so
   api/office-layout.js can answer honestly instead of pretending
   a save landed.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             Desk documents, invites and activity use)
   ===================================================================== */

import { put, list } from "@vercel/blob";

export const LAYOUT_PATHNAME = "office-layout.json";

export function layoutConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* The saved layout, or null when none exists yet / the document
   holds nothing usable. Throws only on Blob transport errors. */
export async function readLayout() {
  const { blobs } = await list({ prefix: LAYOUT_PATHNAME });
  const hit = blobs.find(b => b.pathname === LAYOUT_PATHNAME);
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

/* Persist the layout (or null, for Reset — stored as the JSON
   literal null so readLayout reports "no saved layout"). */
export async function writeLayout(layout) {
  await put(LAYOUT_PATHNAME, JSON.stringify(layout, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}
