/* =====================================================================
   IEC Office — Demo user-activity monitoring (IEC Desk, DrMorgan's
   order 2026-11-05: full monitoring of demo user activity, central
   in the Office).

     POST /api/demo-activity   — ingest (server-to-server)
       Header: x-demo-activity-secret: <DEMO_ACTIVITY_SECRET>
       Body:   { asset, email, name, event, detail, ts, seed }
       Every asset demo's notify endpoint forwards its events here:
       activations, logins, failed / paused / revoked attempts, step
       views, actions, logouts — plus the Office's own invite_sent /
       status_changed events, which api/demo-admin.js writes through
       the same store (api/_demo-activity-store.js).

     GET /api/demo-activity    — read (Desk session required)
       ?asset=<id>&email=<email>&limit=<n>     newest-first feed
       ?summary=1                              per-user rollup
       Window: the last 7 days of stored events.

   STORAGE: Vercel Blob, one JSONL object per asset per day —
   demo-activity/<asset>/<YYYY-MM-DD>.jsonl (see the store module).

   SECURITY: ingest is secret-gated (constant-time compare); a
   missing DEMO_ACTIVITY_SECRET or a missing Blob token fails
   closed with 503 not_configured — never a 500. Reads require the
   Desk session (the same HMAC verify api/demo-admin.js uses).
   Events carry no activation tokens and no passwords: the store's
   normalizer keeps only the known fields and strips token /
   password keys out of details.

   Env (this Vercel project — iecincglobal-site):
     DEMO_ACTIVITY_SECRET    shared secret the asset demos present
                             when forwarding events
     BLOB_READ_WRITE_TOKEN   the Office Blob store (already set for
                             the Desk documents)
     DESK_SESSION_SECRET     (already set for the Desk)
   ===================================================================== */

import { _internals } from "./demo-admin.js";
import {
  ACTIVITY_ASSET_IDS,
  activityConfigured,
  appendActivityEvent,
  isKnownAsset,
  normalizeAssetId,
  normalizeEvent,
  readActivityEvents,
  summarizeEvents
} from "./_demo-activity-store.js";

const { validSession } = _internals;

/* ------------------------------------------------------------------ */
/* Helpers (mirroring api/demo-admin.js)                               */
/* ------------------------------------------------------------------ */

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

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

function queryOf(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  } catch (e) {
    return {};
  }
}

/* What a read may expose — exactly the stored fields, nothing else. */
function publicEvent(evt) {
  const out = {
    asset: String(evt.asset || ""),
    email: String(evt.email || ""),
    name: String(evt.name || ""),
    event: String(evt.event || ""),
    detail: typeof evt.detail === "string" ? evt.detail : "",
    ts: String(evt.ts || ""),
    seed: evt.seed === true
  };
  if (evt.unknown === true) out.unknown = true;
  return out;
}

/* ------------------------------------------------------------------ */
/* POST — ingest                                                       */
/* ------------------------------------------------------------------ */

async function handlePost(req, res) {
  const secret = process.env.DEMO_ACTIVITY_SECRET || "";
  if (!secret) {
    console.log("[demo-activity] NO-OP — DEMO_ACTIVITY_SECRET is not configured for this project; ingest refused.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }
  const presented = req.headers && req.headers["x-demo-activity-secret"];
  if (!timingSafeEqual(String(presented || ""), secret)) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }
  if (!activityConfigured()) {
    console.log("[demo-activity] NO-OP — BLOB_READ_WRITE_TOKEN is not configured for this project; ingest refused.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }

  const body = await readBody(req);
  if (body.asset != null && !isKnownAsset(body.asset)) {
    return reply(res, 400, { ok: false, error: "unknown_asset" });
  }
  const evt = normalizeEvent(body);
  if (!evt) return reply(res, 400, { ok: false, error: "invalid_event" });

  const stored = await appendActivityEvent(evt);
  if (!stored) return reply(res, 502, { ok: false, error: "store_failed" });
  return reply(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* GET — feed + summary (Desk session required)                        */
/* ------------------------------------------------------------------ */

async function handleGet(req, res) {
  const session = getCookie(req.headers && req.headers.cookie, "desk_session");
  if (!session || !(await validSession(session))) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }
  if (!activityConfigured()) {
    console.log("[demo-activity] NO-OP — BLOB_READ_WRITE_TOKEN is not configured for this project; read unavailable.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }

  const q = queryOf(req);
  const assetParam = q.asset ? normalizeAssetId(q.asset) : null;
  if (assetParam && !ACTIVITY_ASSET_IDS.includes(assetParam)) {
    return reply(res, 400, { ok: false, error: "unknown_asset" });
  }
  const emailFilter = q.email ? String(q.email).trim().toLowerCase() : null;
  let limit = Number.parseInt(q.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 200;
  limit = Math.min(limit, 1000);

  let events;
  try {
    events = await readActivityEvents({ days: 7, asset: assetParam });
  } catch (e) {
    console.error(`[demo-activity] read FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  if (emailFilter) events = events.filter(e => String(e.email || "").toLowerCase() === emailFilter);
  events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  if (q.summary === "1" || q.summary === "true") {
    return reply(res, 200, { ok: true, windowDays: 7, summary: summarizeEvents(events) });
  }
  return reply(res, 200, {
    ok: true,
    windowDays: 7,
    events: events.slice(0, limit).map(publicEvent)
  });
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "GET") return handleGet(req, res);
  return reply(res, 405, { ok: false, error: "method_not_allowed" });
}
