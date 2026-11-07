/* =====================================================================
   IEC MSO Data Network — questionnaire submission store (shared
   helper; the leading underscore keeps Vercel from routing it as a
   function, the same convention as api/_demo-invites-store.js).

   Every completed evaluation questionnaire from the public online
   form (questionnaire-form.html → POST /api/questionnaire-submit)
   is appended here as ONE JSON document in the Office Blob store,
   read-modify-write through @vercel/blob with exactly the pattern
   of api/_demo-invites-store.js:

     questionnaire-submissions.json —
       [ { id, receivedAt, segment,
           contact: { name, business, email, phone },
           answers: { "<question label>": "<answer>", ... } } ]

   Answers are COUNTS, DATE RANGES, AND SYSTEM NAMES ONLY — the
   form itself warns, in bold, never to enter patient or
   customer-identifying information. A submission record is the
   evaluation's state, so reads/writes here THROW on transport
   failure: the endpoint must know when a submission could not be
   stored. Configuration is checked first via
   submissionsConfigured(); the endpoint answers 503 when it is
   false and no other channel is available.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             Desk documents, activity and demo
                             invites use)
   ===================================================================== */

import { put, list } from "@vercel/blob";

export const SUBMISSIONS_PATHNAME = "questionnaire-submissions.json";

export function submissionsConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/* The whole submissions document. [] when it does not exist yet or
   holds nothing usable. Throws only on Blob transport errors. */
export async function readSubmissions() {
  const { blobs } = await list({ prefix: SUBMISSIONS_PATHNAME });
  const hit = blobs.find(b => b.pathname === SUBMISSIONS_PATHNAME);
  if (!hit) return [];
  const r = await fetch(hit.url);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(await r.text());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(x => x && typeof x === "object" && x.id && x.segment);
  } catch (e) {
    return [];
  }
}

async function writeSubmissions(records) {
  await put(SUBMISSIONS_PATHNAME, JSON.stringify(records, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

/* Append one submission. Returns the stored record. Throws on
   transport failure. */
export async function appendSubmission(record) {
  const records = await readSubmissions();
  records.push(record);
  await writeSubmissions(records);
  return record;
}

export async function findSubmission(id) {
  const records = await readSubmissions();
  return records.find(x => x.id === id) || null;
}
