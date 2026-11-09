/* =====================================================================
   IEC MSO Data Network — online evaluation questionnaire endpoint.

   POST /api/questionnaire-submit   (JSON body, public)
     { segment, contact: { name, business, email, phone },
       answers: { "<question label>": "<answer>", ... },
       company_website: ""   (honeypot — must stay empty) }

   GET /api/questionnaire-submit?id=<submission id>
     → { ok, found, segment?, receivedAt? } — existence check only;
     no submission content is ever returned. Used to confirm a
     submission landed (e.g. after a test submission).

   The public form (questionnaire-form.html) collects the SAME
   questions as the segment questionnaires: counts, date ranges
   and system names only. The form warns in bold, before any
   field, never to enter patient or customer-identifying
   information. Contact fields are the submitter's own business
   contact, so a submission is attributable and IEC can follow up.

   CHANNELS:
     (a) Database (PRIMARY, since 2026-11-09) — the submission is
         INSERTed into the questionnaire_submissions table of the
         Neon database iec_questionnaires
         (api/_questionnaire-db.js; QUESTIONNAIRE_DATABASE_URL).
         A failed insert surfaces as an error response — never a
         silent loss.
     (b) Blob (BACKUP) — the submission is also appended to
         questionnaire-submissions.json in the Office Blob store
         (api/_questionnaire-store.js; BLOB_READ_WRITE_TOKEN). A
         backup failure is logged but never fails the submission.
     (c) Email — a summary is sent to info@iecincglobal.com via
         Resend (DEMO_ADMIN_RESEND_API_KEY — the same key
         demo-admin uses), From the same system sender pattern
         demo-admin uses ("<org> <onboarding@resend.dev>"), with
         the IEC org signature (logo, no personal name).
         Notification behavior is unchanged.
   If NO store is configured and email is unavailable the endpoint
   fails closed with 503 not_configured — a submission is never
   silently dropped. When the database is not configured the Blob
   store remains the primary write (legacy fallback) with the
   original semantics: success when the Blob append or the email
   lands.

   SANITY: POST only for submissions; bodies over 64 KB are
   rejected (413); every string is length-capped; the answers map
   is capped at 80 entries; a filled honeypot is refused with a
   generic 400. No sessions, no cookies — this is a public intake.

   Env (this Vercel project — iecincglobal-site):
     QUESTIONNAIRE_DATABASE_URL  Neon iec_questionnaires database
     BLOB_READ_WRITE_TOKEN       Office Blob store
     DEMO_ADMIN_RESEND_API_KEY   Resend sending key (demo-admin's)
   ===================================================================== */

import crypto from "node:crypto";
import {
  submissionsConfigured,
  appendSubmission,
  findSubmission
} from "./_questionnaire-store.js";
import {
  dbConfigured,
  insertSubmission,
  findSubmissionInDb
} from "./_questionnaire-db.js";

const SEGMENTS = {
  "pharmacy": "Pharmacy Operations",
  "home-health": "Home Health Operations",
  "pt": "Physical Therapy / Rehab Operations",
  "medical-practice": "Medical Practice / Group Operations",
  "gas-convenience": "Gas Station / Convenience Operations",
  "general-business": "Business Operations (General)"
};

const NOTIFY_TO = "info@iecincglobal.com";
const MAIL_FROM = "IEC MSO Data Network <onboarding@resend.dev>";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ANSWERS = 80;
const MAX_LABEL_CHARS = 300;
const MAX_VALUE_CHARS = 2000;

/* IEC org signature — same shape as demo-admin's IEC-logo org
   signatures (logo, org line, no personal name). */
const SIGNATURE_TEXT = [
  "IEC, Inc. · IEC MSO Data Network",
  "857-867-1767",
  "info@iecincglobal.com"
].join("\n");

const SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
  '<tr><td><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="140" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
  '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
  "<strong>IEC, Inc. · IEC MSO Data Network</strong><br>",
  '<a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
  '<a href="mailto:info@iecincglobal.com" style="color:#1A1A1A;text-decoration:none">info@iecincglobal.com</a>',
  "</td></tr>",
  "</table>"
].join("");

/* ------------------------------------------------------------------ */
/* Small helpers (mirroring api/demo-admin.js)                         */
/* ------------------------------------------------------------------ */

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function plausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cap(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}

function reply(res, code, obj) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(code).json(obj);
  }
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

/* Read the RAW body with a hard byte cap — oversized payloads are
   rejected before any parsing. Resolves null when over the cap. */
function readRawBody(req, capBytes) {
  if (typeof req.body === "string") {
    return Promise.resolve(Buffer.byteLength(req.body, "utf8") > capBytes ? null : req.body);
  }
  if (req.body && typeof req.body === "object") {
    const s = JSON.stringify(req.body);
    return Promise.resolve(Buffer.byteLength(s, "utf8") > capBytes ? null : s);
  }
  return new Promise(resolve => {
    let data = "";
    let size = 0;
    let over = false;
    if (typeof req.on !== "function") return resolve("");
    req.on("data", c => {
      size += c.length;
      if (size > capBytes) { over = true; return; }
      data += c;
    });
    req.on("end", () => resolve(over ? null : data));
    req.on("error", () => resolve(""));
  });
}

/* Keep only string-ish answers, capped in count and length, with
   labels capped too. Non-object input becomes an empty map. */
function sanitizeAnswers(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (n >= MAX_ANSWERS) break;
    if (v == null) continue;
    const value = Array.isArray(v) ? v.map(x => cap(x, 200)).join(", ") : cap(v, MAX_VALUE_CHARS);
    if (!value.trim()) continue;
    out[cap(k, MAX_LABEL_CHARS)] = value;
    n++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Notification email — mirrors demo-admin's Resend sends              */
/* ------------------------------------------------------------------ */

function buildNotification(record) {
  const segName = SEGMENTS[record.segment] || record.segment;
  const c = record.contact;
  const lines = [
    `New data evaluation questionnaire submission — ${segName}.`,
    "",
    `Received: ${record.receivedAt}`,
    `Submission ID: ${record.id}`,
    "",
    "Submitter:",
    `  Name: ${c.name}`,
    `  Business: ${c.business || "—"}`,
    `  Email: ${c.email}`,
    `  Phone: ${c.phone || "—"}`,
    "",
    "Answers (counts, date ranges and system names only):"
  ];
  const htmlRows = [];
  for (const [label, value] of Object.entries(record.answers)) {
    lines.push(`  ${label}: ${value}`);
    htmlRows.push(
      `<tr><td style="padding:6px 10px;border:1px solid #e4e0d6;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5a6b7d;vertical-align:top">${escapeHtml(label)}</td>` +
      `<td style="padding:6px 10px;border:1px solid #e4e0d6;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1c2733">${escapeHtml(value)}</td></tr>`
    );
  }
  if (!htmlRows.length) {
    lines.push("  (no answers provided)");
    htmlRows.push('<tr><td colspan="2" style="padding:6px 10px;border:1px solid #e4e0d6;font-family:Arial,Helvetica,sans-serif;font-size:13px">(no answers provided)</td></tr>');
  }
  lines.push("", "Next step: reply to the submitter; if they proceed, send IEC's exclusive data grant for review.", "", SIGNATURE_TEXT);
  const html = [
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">New data evaluation questionnaire submission — <strong>${escapeHtml(segName)}</strong>.</p>`,
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5a6b7d">Received: ${escapeHtml(record.receivedAt)}<br>Submission ID: ${escapeHtml(record.id)}</p>`,
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><strong>Submitter</strong><br>` +
      `Name: ${escapeHtml(c.name)}<br>Business: ${escapeHtml(c.business || "—")}<br>` +
      `Email: <a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a><br>Phone: ${escapeHtml(c.phone || "—")}</p>`,
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:640px">',
    htmlRows.join(""),
    "</table>",
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5a6b7d">Next step: reply to the submitter; if they proceed, send IEC\'s exclusive data grant for review.</p>',
    SIGNATURE_HTML
  ].join("\n");
  return {
    subject: `New questionnaire submission — ${segName} — ${c.business || c.name}`,
    text: lines.join("\n"),
    html
  };
}

/* { sent:true, id } | { sent:false, reason } — never throws. */
async function sendNotification(record) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "not_configured" };
  const mail = buildNotification(record);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [NOTIFY_TO],
        reply_to: record.contact.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true, id: data.id || null };
  } catch (e) {
    return { sent: false, reason: "send_failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method === "GET") {
    const url = new URL(req.url, "https://iecincglobal.com");

    /* ONE-TIME Blob → database migration (2026-11-09). Fails closed
       unless QDB_MIGRATE_TOKEN is configured AND presented. Runs
       inside this function because only the deployed runtime can
       read the Blob store. Idempotent: existing references are
       skipped. Answers COUNTS ONLY — no submission content. This
       branch is removed once the migration is verified. */
    if (url.searchParams.has("migrate")) {
      const expected = process.env.QDB_MIGRATE_TOKEN || "";
      const presented = url.searchParams.get("token") || "";
      if (!expected || !presented ||
          presented.length !== expected.length ||
          !crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected))) {
        return reply(res, 404, { ok: false, error: "not_found" });
      }
      if (!dbConfigured() || !submissionsConfigured()) {
        return reply(res, 503, { ok: false, error: "not_configured" });
      }
      try {
        const { readSubmissions } = await import("./_questionnaire-store.js");
        const { insertMigratedSubmission, countSubmissions } = await import("./_questionnaire-db.js");
        const records = await readSubmissions();
        let inserted = 0;
        for (const rec of records) {
          if (await insertMigratedSubmission(rec)) inserted++;
        }
        const total = await countSubmissions();
        console.log(`[questionnaire-submit] migration: blob=${records.length} inserted=${inserted} db_total=${total}.`);
        return reply(res, 200, { ok: true, blobCount: records.length, inserted, dbTotal: total });
      } catch (e) {
        console.error(`[questionnaire-submit] migration FAILED: ${e && e.message}`);
        return reply(res, 502, { ok: false, error: "migration_failed" });
      }
    }

    /* Existence check for a known submission id (verification only —
       returns no content). The database is the system of record;
       the Blob backup is consulted second. */
    const id = String(url.searchParams.get("id") || "");
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) {
      return reply(res, 400, { ok: false, error: "invalid_id" });
    }
    if (!dbConfigured() && !submissionsConfigured()) {
      return reply(res, 503, { ok: false, error: "not_configured" });
    }
    try {
      let found = null;
      if (dbConfigured()) {
        found = await findSubmissionInDb(id);
      }
      if (!found && submissionsConfigured()) {
        found = await findSubmission(id);
      }
      return reply(res, 200, {
        ok: true,
        found: !!found,
        ...(found ? { segment: found.segment, receivedAt: found.receivedAt } : {})
      });
    } catch (e) {
      console.error(`[questionnaire-submit] check FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  if (req.method !== "POST") {
    return reply(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const raw = await readRawBody(req, MAX_BODY_BYTES);
  if (raw === null) {
    return reply(res, 413, { ok: false, error: "payload_too_large" });
  }
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch (e) {
    return reply(res, 400, { ok: false, error: "invalid_json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply(res, 400, { ok: false, error: "invalid_body" });
  }

  /* Honeypot: a real owner never sees this field. */
  if (cap(body.company_website, 10).trim()) {
    return reply(res, 400, { ok: false, error: "rejected" });
  }

  const segment = String(body.segment || "");
  if (!SEGMENTS[segment]) {
    return reply(res, 400, { ok: false, error: "unknown_segment" });
  }
  const contactIn = body.contact && typeof body.contact === "object" ? body.contact : {};
  const contact = {
    name: cap(contactIn.name, 200).trim(),
    business: cap(contactIn.business, 200).trim(),
    email: normalizeEmail(contactIn.email),
    phone: cap(contactIn.phone, 60).trim()
  };
  if (!contact.name) return reply(res, 400, { ok: false, error: "name_required" });
  if (!plausibleEmail(contact.email)) return reply(res, 400, { ok: false, error: "invalid_email" });

  const record = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    receivedAt: new Date().toISOString(),
    segment,
    contact,
    answers: sanitizeAnswers(body.answers)
  };

  const dbReady = dbConfigured();
  const blobReady = submissionsConfigured();
  const mailReady = !!process.env.DEMO_ADMIN_RESEND_API_KEY;
  if (!dbReady && !blobReady && !mailReady) {
    console.log("[questionnaire-submit] NO-OP — neither QUESTIONNAIRE_DATABASE_URL, BLOB_READ_WRITE_TOKEN nor DEMO_ADMIN_RESEND_API_KEY is configured; nothing recorded, nothing emailed.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }

  /* PRIMARY write — the database. A failure is surfaced as an error
     response below (never a silent loss); the backup append and the
     notification still run first so the submission also exists
     outside the database. */
  let stored = false;
  let dbFailed = false;
  if (dbReady) {
    try {
      await insertSubmission(
        record,
        body,
        typeof body.company_website === "string" ? body.company_website : ""
      );
      stored = true;
    } catch (e) {
      dbFailed = true;
      console.error(`[questionnaire-submit] DB insert FAILED: ${e && e.message}`);
    }
  }

  /* BACKUP write — the Blob append. Silent: its failure never fails
     the submission. When the database is not configured this remains
     the primary write (legacy fallback) and decides `stored`. */
  if (blobReady) {
    try {
      await appendSubmission(record);
      if (!dbReady) stored = true;
    } catch (e) {
      console.error(`[questionnaire-submit] Blob backup append FAILED: ${e && e.message}`);
    }
  } else if (!dbReady) {
    console.log("[questionnaire-submit] Blob not configured — submission carried by the notification email only.");
  }

  const sent = await sendNotification(record);
  if (!sent.sent && sent.reason !== "not_configured") {
    console.error(`[questionnaire-submit] notification email FAILED (${sent.reason}).`);
  }

  if (dbFailed) {
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  if (!stored && !sent.sent) {
    return reply(res, 502, { ok: false, error: "delivery_failed" });
  }
  console.log(`[questionnaire-submit] submission ${record.id} (${segment}) stored=${stored} emailed=${sent.sent}.`);
  return reply(res, 200, { ok: true, id: record.id, stored, emailed: sent.sent });
}
