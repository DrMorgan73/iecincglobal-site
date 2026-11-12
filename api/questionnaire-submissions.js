/* =====================================================================
   /api/questionnaire-submissions — IEC Suite "Questionnaire
   Submissions" (Desk-only, READ-ONLY).

   The arrivals board for the public online evaluation
   questionnaires (questionnaire-form.html → POST
   /api/questionnaire-submit): newest-first summaries from the
   system of record — the questionnaire_submissions table of the
   Neon database iec_questionnaires (api/_questionnaire-db.js).

   Built 2026-11-11 (audit-till-green): until this endpoint existed
   a submission was invisible unless the Resend notification email
   landed — and that email cannot land until iecincglobal.com is
   verified in Resend. Dana / DrMorgan can now see every arrival in
   the Desk without the email.

   GET /api/questionnaire-submissions?limit=100
     → { ok: true, submissions: [ { id, segment, segmentLabel,
         business, name, receivedAt } ] }   (newest first)

   Summary fields only: segment, received time, business and
   submitter name. Answers are NOT returned — the full record stays
   in the database (and the Blob backup); this is an arrivals
   board, not a record reader. There is no write path here at all.

   Auth: a valid Desk session cookie (desk_session), verified
   exactly as middleware.js / the other Desk APIs verify it. No
   session → 401. A session is never forged here.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET       (already set for the Desk)
     QUESTIONNAIRE_DATABASE_URL (already set for the endpoint)
   ===================================================================== */

import crypto from "node:crypto";
import { dbConfigured, listSubmissions } from "./_questionnaire-db.js";

const SEGMENTS = {
  "pharmacy": "Pharmacy Operations",
  "home-health": "Home Health Operations",
  "pt": "Physical Therapy / Rehab Operations",
  "medical-practice": "Medical Practice / Group Operations",
  "gas-convenience": "Gas Station / Convenience Operations",
  "general-business": "Business Operations (General)",
  "nonprofit": "Nonprofit — School / Mosque"
};

/* ------------------------------------------------------------------ */
/* Desk session verification — mirrors api/data-assets.js exactly.     */
/* ------------------------------------------------------------------ */

function hmacHex(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function getCookie(req, name) {
  const m = String(req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}
function validSession(req) {
  const secret = process.env.DESK_SESSION_SECRET || "";
  if (!secret) return false;
  const raw = getCookie(req, "desk_session");
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  return timingSafeEqual(hmacHex(secret, `${user}.${exp}`), sig);
}

function reply(res, code, obj) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(code).json(obj);
  }
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return reply(res, 405, { ok: false, error: "method_not_allowed" });
  }
  if (!validSession(req)) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }
  if (!dbConfigured()) {
    return reply(res, 503, { ok: false, error: "not_configured" });
  }
  const url = new URL(req.url, "https://iecincglobal.com");
  const limit = url.searchParams.get("limit");
  try {
    const rows = await listSubmissions(limit);
    return reply(res, 200, {
      ok: true,
      submissions: rows.map(r => ({
        ...r,
        segmentLabel: SEGMENTS[r.segment] || r.segment
      }))
    });
  } catch (e) {
    console.error(`[questionnaire-submissions] list FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
}
