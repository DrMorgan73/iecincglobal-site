/* =====================================================================
   IEC Office — Demo user-activity store (shared helper; the leading
   underscore keeps Vercel from routing it as a function, the same
   convention as medexec-site's api/_signature.js).

   Every asset demo forwards its user-activity events to the Office
   (POST /api/demo-activity), and the Office's own control actions
   (api/demo-admin.js) record theirs here too. Events live in Vercel
   Blob as newline-delimited JSON, one object per asset per day:

     demo-activity/<asset>/<YYYY-MM-DD>.jsonl     (day = America/New_York)

   Each line is one event with exactly these fields:
     { asset, email, name, event, detail, ts, seed }
   plus `unknown: true` when the event type is not in KNOWN_EVENTS.
   Activation tokens and passwords are NEVER activity data: the
   normalizer below picks only the known fields and strips token /
   password keys out of object details.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN   the Office Blob store (same store the
                             Desk documents use; see api/desk-docs.js)

   Fail-closed: without the Blob token the writer is a logged NO-OP
   (returns false, never throws) so a control action in demo-admin
   can never be failed by its own audit trail, and the reader
   reports "not_configured" so api/demo-activity.js can answer 503.
   ===================================================================== */

import { put, list } from "@vercel/blob";

/* ------------------------------------------------------------------ */
/* Config — the ONE place asset ids and event types are listed.        */
/* A future asset demo joins monitoring by adding its id here.         */
/* ("iecdocs" is the monitoring id for the registry's "iec-docs".)     */
/* ------------------------------------------------------------------ */

export const ACTIVITY_ASSET_IDS = ["medexec", "insnap", "curavia", "insnapp", "iecdocs"];

export const KNOWN_EVENTS = [
  "activated",
  "login",
  "login_failed",
  "paused_attempt",
  "revoked_attempt",
  "step_view",
  "action",
  "logout",
  "invite_sent",
  "nda_sent",
  "nda_signed",
  "status_changed"
];

const PREFIX = "demo-activity/";
const DAY_MS = 24 * 3600 * 1000;

/* The Desk registry calls it "iec-docs"; monitoring calls it
   "iecdocs". Accept either, store the canonical monitoring id. */
export function normalizeAssetId(id) {
  const raw = String(id || "").trim().toLowerCase();
  return raw === "iec-docs" ? "iecdocs" : raw;
}

export function isKnownAsset(id) {
  return ACTIVITY_ASSET_IDS.includes(normalizeAssetId(id));
}

/* ------------------------------------------------------------------ */
/* Day keys — America/New_York wall date, matching the Desk's clock    */
/* ------------------------------------------------------------------ */

export function dayKey(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/* The last n day keys, today (ET) first. */
export function recentDayKeys(n, now = new Date()) {
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
  return keys;
}

/* ------------------------------------------------------------------ */
/* Event normalization — the only shape that ever reaches storage      */
/* ------------------------------------------------------------------ */

const FORBIDDEN_DETAIL_KEYS = ["token", "password", "secret", "activationtoken", "apikey", "api_key"];

function cleanDetail(detail) {
  if (detail == null) return "";
  if (typeof detail === "object") {
    const out = {};
    for (const [k, v] of Object.entries(detail)) {
      if (FORBIDDEN_DETAIL_KEYS.includes(k.toLowerCase())) continue;
      out[k] = v;
    }
    return JSON.stringify(out).slice(0, 1000);
  }
  return String(detail).slice(0, 1000);
}

/* Returns a storable event, or null when the input is unusable
   (unknown asset, implausible email, missing event type). Unknown
   event TYPES are kept and flagged `unknown: true`. */
export function normalizeEvent(input, now = new Date()) {
  if (!input || typeof input !== "object") return null;
  const asset = normalizeAssetId(input.asset);
  if (!ACTIVITY_ASSET_IDS.includes(asset)) return null;
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null;
  const event = String(input.event || "").trim().toLowerCase();
  if (!event) return null;
  const parsed = input.ts ? new Date(input.ts) : null;
  const ts = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : now.toISOString();
  const evt = {
    asset,
    email,
    name: String(input.name || "").slice(0, 200),
    event,
    detail: cleanDetail(input.detail),
    ts,
    seed: input.seed === true
  };
  if (!KNOWN_EVENTS.includes(event)) evt.unknown = true;
  return evt;
}

/* ------------------------------------------------------------------ */
/* Blob read / append                                                  */
/* ------------------------------------------------------------------ */

export function activityConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function pathnameFor(evt) {
  return `${PREFIX}${evt.asset}/${dayKey(new Date(evt.ts))}.jsonl`;
}

async function readBlobText(pathname) {
  const { blobs } = await list({ prefix: pathname });
  const hit = blobs.find(b => b.pathname === pathname);
  if (!hit) return "";
  const r = await fetch(hit.url);
  if (!r.ok) return "";
  return r.text();
}

/* Append one event as one JSON line to its asset/day object.
   Best-effort by design: returns true when stored, false when the
   store is not configured or the write failed — it NEVER throws,
   so callers (demo-admin control actions, the ingest endpoint's
   Office-side mirror) are never failed by the audit trail. */
export async function appendActivityEvent(input, now = new Date()) {
  const evt = normalizeEvent(input, now);
  if (!evt) return false;
  if (!activityConfigured()) {
    console.log("[demo-activity] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; activity event dropped.");
    return false;
  }
  try {
    const pathname = pathnameFor(evt);
    const prior = await readBlobText(pathname);
    const line = JSON.stringify(evt) + "\n";
    await put(pathname, prior + line, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/x-ndjson"
    });
    return true;
  } catch (e) {
    console.error(`[demo-activity] append FAILED: ${e && e.message}`);
    return false;
  }
}

/* Read events from the last `days` day-objects. scope: { asset? }
   (one asset id; absent = every known asset). Returns parsed events
   in storage order — callers sort/filter. Throws only on Blob
   transport errors; callers translate that to a 502. */
export async function readActivityEvents({ days = 7, asset = null } = {}, now = new Date()) {
  const assets = asset ? [normalizeAssetId(asset)] : ACTIVITY_ASSET_IDS;
  const keys = new Set(recentDayKeys(days, now));
  const events = [];
  for (const id of assets) {
    const { blobs } = await list({ prefix: `${PREFIX}${id}/` });
    const wanted = blobs
      .filter(b => keys.has(b.pathname.slice(PREFIX.length + id.length + 1, -".jsonl".length)))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));
    for (const b of wanted) {
      const r = await fetch(b.url);
      if (!r.ok) continue;
      const text = await r.text();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          if (evt && typeof evt === "object" && evt.ts) events.push(evt);
        } catch (e) { /* skip a torn line */ }
      }
    }
  }
  return events;
}

/* Per-user rollup over an event list: last activity, counts by
   event type, assets touched. Sorted by last activity, newest
   first. */
export function summarizeEvents(events) {
  const users = new Map();
  for (const evt of events) {
    const email = String(evt.email || "").toLowerCase();
    if (!email) continue;
    if (!users.has(email)) {
      users.set(email, {
        email,
        name: "",
        lastActivity: null,
        firstSeen: null,
        total: 0,
        counts: {},
        assets: []
      });
    }
    const u = users.get(email);
    u.total++;
    u.counts[evt.event] = (u.counts[evt.event] || 0) + 1;
    if (evt.name && (!u.lastActivity || evt.ts >= u.lastActivity)) u.name = String(evt.name);
    if (!u.lastActivity || evt.ts > u.lastActivity) u.lastActivity = evt.ts;
    if (!u.firstSeen || evt.ts < u.firstSeen) u.firstSeen = evt.ts;
    if (evt.asset && !u.assets.includes(evt.asset)) u.assets.push(evt.asset);
  }
  const rows = [...users.values()];
  for (const u of rows) u.assets.sort();
  rows.sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
  return rows;
}
