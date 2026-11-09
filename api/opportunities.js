/* =====================================================================
   IEC Office — Dana Opportunities API (DrMorgan's order 2026-11-09:
   the Dana — Opportunities page "needs to be live and search
   opportunities").

   Until today the pipeline lived in localStorage on one browser
   ("Saved privately in this browser"). It now lives server-side in
   the Office Blob store, like the Dana follow-up board and the
   Office layout — saved in the Suite, on every device.

   GET  /api/opportunities
     → 200 { ok: true, configured, opportunities: [...] }
       The saved pipeline, sanitized on the way out. Nothing saved
       yet → an empty array: the pipeline is genuinely empty until
       DrMorgan adds to it; nothing is ever seeded here.
   POST /api/opportunities   (JSON body)
     { opportunities: [...] }   (a bare array body is accepted too)
       → every entry is sanitized to the page's field shape (unknown
         fields dropped, strings trimmed and length-capped, verdicts
         restricted to the four the page uses, entries with no name
         dropped, duplicate ids collapsed), stored, and answered
         200 { ok: true, opportunities } with the array as stored.

   AUTH: the Desk session cookie, verified with exactly the scheme
   middleware.js / api/dana-dashboard.js use (HMAC-SHA256 over
   "<user>.<exp>", DESK_SESSION_SECRET). No session → 401.

   STORAGE: one Blob document, opportunities.json, via
   api/_opportunities-store.js — the same Office Blob store as the
   Desk documents, NDA invites and demo activity. When the store is
   not configured, GET answers an empty pipeline with
   configured:false and POST answers 503 { error: "not_configured" }
   — a save is never faked.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET   (already set for the Desk)
     BLOB_READ_WRITE_TOKEN (already set for the Office)
   ===================================================================== */

import crypto from "node:crypto";
import { opportunitiesConfigured, readOpportunities, writeOpportunities } from "./_opportunities-store.js";

/* ------------------------------------------------------------------ */
/* Desk session verification — mirrors middleware.js exactly           */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret, data) {
  const key = await crypto.webcrypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(await crypto.webcrypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function validSession(value) {
  const secret = process.env.DESK_SESSION_SECRET;
  if (!secret) return false;
  const parts = String(value).split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = await hmacHex(secret, user + "." + exp);
  return timingSafeEqual(sig, expected);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return new Promise(resolve => {
    let data = "";
    if (typeof req.on !== "function") return resolve({});
    req.on("data", c => { data += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function reply(res, code, obj) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(code).json(obj);
  }
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

/* ------------------------------------------------------------------ */
/* Sanitizers — the pipeline is DrMorgan's data; anything stored     */
/* goes through here so a hand-edited or stale document can never    */
/* inject markup-sized strings or unknown shapes into the page.      */
/* Field shape mirrors the page's intake form exactly.               */
/* ------------------------------------------------------------------ */

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const validId = v => {
  const id = String(v ?? "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
};

const TYPES = ["Residential", "Commercial", "Land", "Mixed-use"];
const SIDES = ["Sell", "Buy"];
const VERDICTS = ["solid", "couldbe", "pass", "unscored"];

function sanitizeOpportunity(o, i) {
  if (!o || typeof o !== "object") return null;
  const name = str(o.name, 80);
  if (!name) return null;
  let value = "";
  if (typeof o.value === "number" && Number.isFinite(o.value)) value = o.value;
  else if (o.value !== undefined && o.value !== null && String(o.value).trim() !== "") {
    const n = Number(String(o.value).replace(/[^0-9.]/g, ""));
    value = Number.isFinite(n) ? n : "";
  }
  return {
    id: validId(o.id) || `o-${i + 1}`,
    name,
    type: TYPES.includes(o.type) ? o.type : "Residential",
    side: SIDES.includes(o.side) ? o.side : "Sell",
    value,
    source: str(o.source, 40),
    contact: str(o.contact, 80),
    verdict: VERDICTS.includes(o.verdict) ? o.verdict : "unscored",
    notes: str(o.notes, 500),
    added: str(o.added, 40)
  };
}

function sanitizeOpportunities(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  value.forEach((entry, i) => {
    if (out.length >= 500) return;
    const clean = sanitizeOpportunity(entry, i);
    if (!clean || seen.has(clean.id)) return;
    seen.add(clean.id);
    out.push(clean);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  const cookie = getCookie(req.headers && req.headers.cookie, "desk_session");
  if (!cookie || !(await validSession(cookie))) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }

  const method = String(req.method || "GET").toUpperCase();

  if (method === "GET") {
    if (!opportunitiesConfigured()) {
      return reply(res, 200, { ok: true, configured: false, opportunities: [] });
    }
    try {
      const saved = await readOpportunities();
      return reply(res, 200, {
        ok: true,
        configured: true,
        opportunities: sanitizeOpportunities(saved || [])
      });
    } catch (e) {
      console.error(`[opportunities] read FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  if (method === "POST") {
    if (!opportunitiesConfigured()) {
      console.log("[opportunities] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; the pipeline cannot be saved.");
      return reply(res, 503, { ok: false, error: "not_configured" });
    }
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body && body.opportunities);
    const clean = sanitizeOpportunities(list);
    try {
      await writeOpportunities(clean);
      return reply(res, 200, { ok: true, opportunities: clean });
    } catch (e) {
      console.error(`[opportunities] save FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  return reply(res, 405, { ok: false, error: "method_not_allowed" });
}

/* Exposed for the local test suite only. */
export const _internals = { sanitizeOpportunity, sanitizeOpportunities, TYPES, SIDES, VERDICTS };
