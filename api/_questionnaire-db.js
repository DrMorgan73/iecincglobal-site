/* =====================================================================
   IEC MSO Data Network — questionnaire submissions DATABASE store
   (shared helper; the leading underscore keeps Vercel from routing
   it as a function, the same convention as the other api/_*.js
   stores).

   Since 2026-11-09 the system of record for online questionnaire
   submissions is a Postgres table (Neon), not the Blob document:

     Database  iec_questionnaires — Neon project "private-library"
               (snowy-band-99009019), main branch
     Table     questionnaire_submissions
                 id              uuid PK, default gen_random_uuid()
                 reference       text UNIQUE — the submission id the
                                 endpoint issues (record.id)
                 segment         text
                 contact         jsonb  { name, business, email, phone }
                 answers         jsonb  { "<label>": "<answer>", ... }
                 company_website text   (honeypot; empty on real
                                 submissions — stored for fidelity)
                 submitted_at    timestamptz, default now()
                 raw_payload     jsonb  — the exact received payload
               Indexes on submitted_at and segment.

   The endpoint (api/questionnaire-submit.js) INSERTs here FIRST;
   the Blob append (api/_questionnaire-store.js) remains only as a
   silent backup write. A failed INSERT throws so the endpoint can
   answer an error — a submission is never silently lost.

   Transport: Neon's HTTPS SQL endpoint (POST https://<host>/sql
   with the connection string in the Neon-Connection-String header)
   — the same pattern the Neon connector documents for this
   environment; it needs no extra npm dependency and runs anywhere
   fetch does. The host is derived from the connection URI; the
   pooled host is used as given.

   Env (this Vercel project — iecincglobal-site):
     QUESTIONNAIRE_DATABASE_URL   Neon connection URI for the
                                  iec_questionnaires database
   ===================================================================== */

const TABLE = "questionnaire_submissions";

export function dbConfigured() {
  return !!process.env.QUESTIONNAIRE_DATABASE_URL;
}

/* Parse the connection URI once. Throws on a malformed value so a
   misconfiguration surfaces as a store failure, not a silent skip. */
function connection() {
  const uri = process.env.QUESTIONNAIRE_DATABASE_URL || "";
  const u = new URL(uri);
  return { uri, host: u.hostname };
}

/* Run ONE parameterized statement over Neon's HTTPS SQL endpoint.
   Resolves the parsed response ({ rows, rowCount, ... }); throws on
   transport failure or a Postgres error. */
async function runSql(query, params) {
  const { uri, host } = connection();
  const r = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": uri,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, params: params || [] })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || data.severity === "ERROR" || data.code) {
    const msg = (data && (data.message || data.code)) || `http_${r.status}`;
    throw new Error(`questionnaire db: ${msg}`);
  }
  return data;
}

/* Insert one submission as the primary record. `record` is the
   endpoint's stored shape ({ id, receivedAt, segment, contact,
   answers }); `rawPayload` is the exact received request body
   (stored verbatim in raw_payload); `companyWebsite` is the raw
   honeypot value (empty for real submissions). Returns the row's
   reference. Throws on any failure. */
export async function insertSubmission(record, rawPayload, companyWebsite) {
  const data = await runSql(
    `INSERT INTO ${TABLE} (reference, segment, contact, answers, company_website, submitted_at, raw_payload)` +
    ` VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::timestamptz, $7::jsonb)` +
    ` RETURNING reference`,
    [
      record.id,
      record.segment,
      JSON.stringify(record.contact || {}),
      JSON.stringify(record.answers || {}),
      companyWebsite == null ? null : String(companyWebsite),
      record.receivedAt,
      rawPayload == null ? null : JSON.stringify(rawPayload)
    ]
  );
  const row = data.rows && data.rows[0];
  if (!row || !row.reference) {
    throw new Error("questionnaire db: insert returned no row");
  }
  return row.reference;
}

/* Existence/content lookup by reference for the endpoint's GET
   check. Resolves { segment, receivedAt } or null. Throws on
   transport failure (the caller decides how to answer). */
export async function findSubmissionInDb(reference) {
  const data = await runSql(
    `SELECT segment, submitted_at FROM ${TABLE} WHERE reference = $1`,
    [reference]
  );
  const row = data.rows && data.rows[0];
  if (!row) return null;
  return {
    segment: row.segment,
    receivedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null
  };
}
