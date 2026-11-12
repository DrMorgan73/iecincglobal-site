/* =====================================================================
   IEC Office — "My Office" layout API (DrMorgan's order 2026-11-09:
   an office inside the Office where he can see everything at once
   and rearrange it — "the Office is too convoluted").

   GET  /api/office-layout
     → 200 { ok: true, configured, layout }   layout is null when
       DrMorgan has never saved an arrangement (or after Reset):
       every surface then renders the default module order.
   POST /api/office-layout   (JSON body)
     { order: [moduleId, ...], hidden: [moduleId, ...] }
       → sanitizes both lists against the module registry below
         (unknown ids dropped, duplicates dropped, modules missing
         from "order" appended in default order so a module added
         later still shows up), stores the document, and answers
         200 { ok: true, layout } with the layout as stored.
     { action: "reset" }
       → clears the saved layout (the store keeps a JSON null) and
         answers 200 { ok: true, layout: null }.

   AUTH: the Desk session cookie, verified with exactly the scheme
   middleware.js / api/demo-admin.js use (HMAC-SHA256 over
   "<user>.<exp>", DESK_SESSION_SECRET). No session → 401.

   STORAGE: one Blob document, office-layout.json, via
   api/_office-layout-store.js — the same Office Blob store as the
   Desk documents, NDA invites and demo activity, so the layout
   follows DrMorgan across devices and browsers. When the store is
   not configured, GET answers layout:null (pages render defaults)
   and POST answers 503 { error: "not_configured" } — a save is
   never faked.

   Consolidation (2026-11-09, DrMorgan: "My office is duplicate of
   the suite fix it"): there is ONE office surface — the "Your
   office" grid on desk/office.html carries the rearrange controls
   (drag / ↑↓ / hide / reset) that used to live on a separate
   Organizer page. The retired "organizer" module id is gone from
   the registry below; a layout document saved before the
   consolidation may still name it, and the sanitizer drops it
   like any other unknown id — stale layouts load clean.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET   (already set for the Desk)
     BLOB_READ_WRITE_TOKEN (already set for the Office)
   ===================================================================== */

import crypto from "node:crypto";
import { layoutConfigured, readLayout, writeLayout } from "./_office-layout-store.js";

/* ------------------------------------------------------------------ */
/* The module registry — ids must match desk/desk.js NAV_GROUPS.       */
/* This server-side copy is the allowlist POST sanitizes against.      */
/* ------------------------------------------------------------------ */

const MODULE_IDS = [
  "home", "suzy-chat", "demo-users",
  "opps", "dana-followup", "data-builder", "questionnaire-submissions", "deals", "contacts",
  "projects", "team", "meeting",
  "office", "virtual",
  "news", "growth", "strategy", "trade",
  "yt-archive", "docs", "vault"
];

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

/* Keep only known ids, in the order given, without duplicates. */
function sanitizeIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const v of value) {
    const id = String(v || "");
    if (!MODULE_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/* Insert any module the given order forgot at its registry position —
   after the nearest registry predecessor that IS in the order — never
   dumped at the end: a module shipped after the layout was saved
   (e.g. Dana — Follow-Up) must surface next to its neighbours, not at
   the bottom of the sidebar. The modules that ARE in the order keep
   their relative order exactly (they are DrMorgan's arrangement).
   Mirrors insertMissingInRegistryOrder() in desk/desk.js. */
function insertMissing(order) {
  const out = order.slice();
  for (let i = 0; i < MODULE_IDS.length; i++) {
    const id = MODULE_IDS[i];
    if (out.includes(id)) continue;
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.indexOf(MODULE_IDS[j]);
      if (idx >= 0) { insertAt = idx + 1; break; }
    }
    out.splice(insertAt, 0, id);
  }
  return out;
}

/* A complete, storable layout from a request body: the requested
   order, with any module it forgot inserted at its registry position
   (a module shipped later must appear, in its place, not vanish),
   plus the hidden list as given (known ids only, via the sanitizer —
   the retired "organizer" id is unknown now and drops out there). */
function buildLayout(body) {
  const order = insertMissing(sanitizeIds(body && body.order));
  const hidden = sanitizeIds(body && body.hidden);
  return { order, hidden, updatedAt: new Date().toISOString() };
}

/* A stored layout goes back out through the same sanitizer, so a
   hand-edited or stale document can never inject an unknown id —
   including "organizer", retired in the 2026-11-09 consolidation. */
function publicLayout(stored) {
  if (!stored || typeof stored !== "object") return null;
  return buildLayout(stored);
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
    if (!layoutConfigured()) return reply(res, 200, { ok: true, configured: false, layout: null });
    try {
      const layout = publicLayout(await readLayout());
      return reply(res, 200, { ok: true, configured: true, layout });
    } catch (e) {
      console.error(`[office-layout] read FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  if (method === "POST") {
    if (!layoutConfigured()) {
      console.log("[office-layout] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; the layout cannot be saved.");
      return reply(res, 503, { ok: false, error: "not_configured" });
    }
    const body = await readBody(req);
    try {
      if (body && body.action === "reset") {
        await writeLayout(null);
        return reply(res, 200, { ok: true, layout: null });
      }
      const layout = buildLayout(body || {});
      await writeLayout(layout);
      return reply(res, 200, { ok: true, layout });
    } catch (e) {
      console.error(`[office-layout] save FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  return reply(res, 405, { ok: false, error: "method_not_allowed" });
}

/* Exposed for the local test suite only. */
export const _internals = { MODULE_IDS, buildLayout, sanitizeIds, publicLayout, insertMissing };
