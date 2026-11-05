/* =====================================================================
   IEC Office — YT Archive API (IEC Desk, DrMorgan's order 2026-11-05:
   the YouTube channel archiver becomes an Office tool — links are
   queued here in the Desk, and the archive runner on DrMorgan's Mac
   claims them, downloads, and reports back).

     POST /api/yt-archive?action=queue     Desk session required
       Body { url, quality?, subtitles?, audioOnly? }
       Creates a job { id, url, options, status:"queued", ... }.
     GET  /api/yt-archive?action=jobs      Desk session OR sync secret
       Returns every job, newest first.
     POST /api/yt-archive?action=claim     sync secret only
       Body { id } — a queued job becomes "running".
     POST /api/yt-archive?action=progress  sync secret only
       Body { id, progress } — progress is merged into the job.
     POST /api/yt-archive?action=complete  sync secret only
       Body { id, manifest, totals } — job becomes "done".
     POST /api/yt-archive?action=fail      sync secret only
       Body { id, error } — job becomes "failed".
     POST /api/yt-archive?action=cancel    Desk session required
       Body { id } — a queued job becomes "cancelled".

   The action may also arrive as body.action (the demo-admin style);
   the query parameter wins when both are present.

   AUTH — two gates, mirroring the sibling endpoints:
     * Desk actions (queue, cancel, and one way into jobs) use the
       desk_session cookie, verified with exactly the scheme
       middleware.js / api/demo-admin.js use (HMAC-SHA256 over
       "<user>.<exp>", DESK_SESSION_SECRET). No session → 401.
     * Runner actions (claim, progress, complete, fail — and the
       other way into jobs) present the shared sync secret in the
       x-yt-archive-secret header, compared in constant time
       against YT_ARCHIVE_SYNC_SECRET, exactly the way
       api/demo-activity.js gates its ingest. The secret is never
       logged and never returned.

   STORAGE: one JSON document in the Office Blob store (the same
   "iec-suite-docs" store the Desk documents and the demo-activity
   store use):
     yt-archive/jobs.json    — an array of job objects
   Read-modify-write through @vercel/blob with the read pattern of
   api/_demo-activity-store.js (list → fetch the object's URL →
   put with addRandomSuffix:false, allowOverwrite:true). The Desk
   is a single-operator tool and the runner reports in sequence,
   so last-write-wins on a torn race is acceptable here — the same
   trade the activity store makes.

   FAIL-CLOSED: a missing YT_ARCHIVE_SYNC_SECRET makes the machine
   actions answer 503 { error: "not_configured" }; a missing
   BLOB_READ_WRITE_TOKEN does the same for every action (nothing
   can be stored); a missing session answers 401. Nothing fails
   open, and nothing writes before its gate has passed.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET     (already set for the Desk)
     BLOB_READ_WRITE_TOKEN   (already set — the Office Blob store)
     YT_ARCHIVE_SYNC_SECRET  shared secret the Mac runner presents
                             (set at apply time; the same value is
                             configured on the runner — it lives in
                             neither codebase)
   ===================================================================== */

import crypto from "node:crypto";
import { put, list } from "@vercel/blob";

const JOBS_PATHNAME = "yt-archive/jobs.json";
const QUALITIES = ["best", "1080", "720", "480"];
const TERMINAL_STATUSES = ["done", "failed", "cancelled"];
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

/* ------------------------------------------------------------------ */
/* Desk session verification — mirrors api/demo-admin.js exactly       */
/* (the helpers are copied, not imported, so this file is             */
/* self-contained — the same choice api/desk-docs.js makes).          */
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

async function hasSession(req) {
  const session = getCookie(req.headers && req.headers.cookie, "desk_session");
  return !!session && validSession(session);
}

/* "ok" | "unauthorized" | "not_configured" — never logs the secret. */
function syncSecretState(req) {
  const secret = process.env.YT_ARCHIVE_SYNC_SECRET || "";
  if (!secret) return "not_configured";
  const presented = req.headers && req.headers["x-yt-archive-secret"];
  return timingSafeEqual(String(presented || ""), secret) ? "ok" : "unauthorized";
}

/* ------------------------------------------------------------------ */
/* Small helpers (mirroring api/demo-admin.js)                         */
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

function queryOf(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(req.url, "http://localhost").searchParams);
  } catch (e) {
    return {};
  }
}

/* "2026-11-05T06:05:00-05:00" — America/New_York wall time with its
   UTC offset, the format api/demo-admin.js stamps its records with. */
function easternIso(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  let offMin = Math.round((asUTC - date.getTime()) / 60000);
  const sign = offMin < 0 ? "-" : "+";
  offMin = Math.abs(offMin);
  const oh = String(Math.floor(offMin / 60)).padStart(2, "0");
  const om = String(offMin % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${oh}:${om}`;
}

/* ------------------------------------------------------------------ */
/* Validation + cleaning                                               */
/* ------------------------------------------------------------------ */

/* Accepts only youtube.com / youtu.be links (channel, playlist, or
   video — the runner resolves all three). Returns the normalized
   URL string, or null. */
function plausibleYoutubeUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) return null;
  return u.toString();
}

function cleanQuality(raw) {
  if (raw == null || raw === "") return "best";
  const q = String(raw).trim().toLowerCase();
  return QUALITIES.includes(q) ? q : null;
}

/* Merge-safe progress: only the known fields, coerced and bounded. */
function cleanProgress(p) {
  const src = p && typeof p === "object" ? p : {};
  const out = {};
  const int = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : undefined);
  const done = int(src.done);
  if (done !== undefined) out.done = done;
  if (src.total === null) out.total = null;
  else {
    const total = int(src.total);
    if (total !== undefined) out.total = total;
  }
  const bytes = int(src.bytes);
  if (bytes !== undefined) out.bytes = bytes;
  if (typeof src.current === "string") out.current = src.current.slice(0, 300);
  return out;
}

/* Catalog rows as the Desk page renders them: { date, title,
   duration } (seconds). Accepts the runner's upload_date /
   duration_sec spellings too and normalizes to the one shape. */
function cleanManifest(m) {
  if (!Array.isArray(m)) return null;
  const rows = [];
  for (const e of m.slice(0, 10000)) {
    if (!e || typeof e !== "object") continue;
    const durRaw = e.duration != null ? e.duration : e.duration_sec;
    const dur = Number(durRaw);
    const row = {
      date: String(e.date || e.upload_date || "").slice(0, 32),
      title: String(e.title || "").slice(0, 500),
      duration: Number.isFinite(dur) ? Math.max(0, Math.floor(dur)) : null,
      id: String(e.id || e.video_id || "").slice(0, 32),
      url: String(e.url || "").slice(0, 500)
    };
    if (row.title || row.id) rows.push(row);
  }
  return rows;
}

function cleanTotals(t) {
  if (t == null) return null;
  if (typeof t !== "object" || Array.isArray(t)) return undefined; // invalid
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 200);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Job store — one JSON document in the Office Blob store              */
/* ------------------------------------------------------------------ */

function storeConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function readJobs() {
  const { blobs } = await list({ prefix: JOBS_PATHNAME });
  const hit = blobs.find(b => b.pathname === JOBS_PATHNAME);
  if (!hit) return [];
  const r = await fetch(hit.url);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(await r.text());
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function writeJobs(jobs) {
  await put(JOBS_PATHNAME, JSON.stringify(jobs, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

function newestFirst(jobs) {
  /* createdAt has one-second resolution, so same-second ties break
     by insertion order (jobs are appended — a later array position
     is the newer job). */
  return jobs
    .map((job, i) => ({ job, i }))
    .sort((a, b) =>
      String(b.job.createdAt).localeCompare(String(a.job.createdAt)) || b.i - a.i)
    .map(({ job }) => job);
}

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

/* Session gate for Desk actions. true = proceed; false = answered. */
async function gateSession(req, res) {
  if (await hasSession(req)) return true;
  reply(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

/* Sync-secret gate for runner actions. true = proceed. */
function gateSecret(req, res) {
  const state = syncSecretState(req);
  if (state === "ok") return true;
  if (state === "not_configured") {
    console.log("[yt-archive] NO-OP — YT_ARCHIVE_SYNC_SECRET is not configured for this project; machine action refused.");
    reply(res, 503, { ok: false, error: "not_configured" });
    return false;
  }
  reply(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

/* Store gate, checked after auth. true = proceed. */
function gateStore(res) {
  if (storeConfigured()) return true;
  console.log("[yt-archive] NO-OP — BLOB_READ_WRITE_TOKEN is not configured for this project; nothing stored.");
  reply(res, 503, { ok: false, error: "not_configured" });
  return false;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function actionQueue(req, res, body) {
  if (!(await gateSession(req, res))) return;
  if (!gateStore(res)) return;

  const url = plausibleYoutubeUrl(body.url);
  if (!url) return reply(res, 400, { ok: false, error: "invalid_url" });
  const quality = cleanQuality(body.quality);
  if (!quality) return reply(res, 400, { ok: false, error: "invalid_quality" });

  const job = {
    id: crypto.randomUUID(),
    url,
    options: {
      quality,
      subtitles: body.subtitles === true,
      audioOnly: body.audioOnly === true
    },
    status: "queued",
    createdAt: easternIso(new Date()),
    claimedAt: null,
    updatedAt: null,
    completedAt: null,
    progress: { done: 0, total: null, bytes: 0, current: "" },
    manifest: [],
    totals: null,
    error: null
  };
  try {
    const jobs = await readJobs();
    jobs.push(job);
    await writeJobs(jobs);
  } catch (e) {
    console.error(`[yt-archive] queue FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  console.log(`[yt-archive] job ${job.id} queued (${url}).`);
  return reply(res, 200, { ok: true, job });
}

async function actionJobs(req, res) {
  /* Either gate opens the read: the Desk session, or the runner's
     sync secret. A presented-but-unset secret reports 503 so a
     misconfigured runner notices; anything else without a session
     is a plain 401. */
  const presented = req.headers && req.headers["x-yt-archive-secret"];
  const state = syncSecretState(req);
  if (state !== "ok" && !(await hasSession(req))) {
    if (presented && state === "not_configured") {
      console.log("[yt-archive] NO-OP — YT_ARCHIVE_SYNC_SECRET is not configured for this project; secret read refused.");
      return reply(res, 503, { ok: false, error: "not_configured" });
    }
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }
  if (!gateStore(res)) return;
  let jobs;
  try {
    jobs = await readJobs();
  } catch (e) {
    console.error(`[yt-archive] jobs read FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  return reply(res, 200, { ok: true, jobs: newestFirst(jobs) });
}

async function actionClaim(req, res, body) {
  if (!gateSecret(req, res)) return;
  if (!gateStore(res)) return;
  const id = String(body.id || "");
  if (!id) return reply(res, 400, { ok: false, error: "id_required" });
  try {
    const jobs = await readJobs();
    const job = jobs.find(j => j.id === id) || null;
    if (!job) return reply(res, 404, { ok: false, error: "not_found" });
    if (job.status !== "queued") {
      return reply(res, 200, { ok: false, error: "not_queued", status: job.status });
    }
    job.status = "running";
    job.claimedAt = easternIso(new Date());
    job.updatedAt = job.claimedAt;
    await writeJobs(jobs);
    console.log(`[yt-archive] job ${job.id} claimed by the runner.`);
    return reply(res, 200, { ok: true, job });
  } catch (e) {
    console.error(`[yt-archive] claim FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
}

async function actionProgress(req, res, body) {
  if (!gateSecret(req, res)) return;
  if (!gateStore(res)) return;
  const id = String(body.id || "");
  if (!id) return reply(res, 400, { ok: false, error: "id_required" });
  try {
    const jobs = await readJobs();
    const job = jobs.find(j => j.id === id) || null;
    if (!job) return reply(res, 404, { ok: false, error: "not_found" });
    if (TERMINAL_STATUSES.includes(job.status)) {
      return reply(res, 200, { ok: false, error: "job_finished", status: job.status });
    }
    job.progress = { ...job.progress, ...cleanProgress(body.progress) };
    job.updatedAt = easternIso(new Date());
    await writeJobs(jobs);
    return reply(res, 200, { ok: true, job });
  } catch (e) {
    console.error(`[yt-archive] progress FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
}

async function actionComplete(req, res, body) {
  if (!gateSecret(req, res)) return;
  if (!gateStore(res)) return;
  const id = String(body.id || "");
  if (!id) return reply(res, 400, { ok: false, error: "id_required" });
  const manifest = cleanManifest(body.manifest);
  if (!manifest) return reply(res, 400, { ok: false, error: "invalid_manifest" });
  const totals = cleanTotals(body.totals);
  if (totals === undefined) return reply(res, 400, { ok: false, error: "invalid_totals" });
  try {
    const jobs = await readJobs();
    const job = jobs.find(j => j.id === id) || null;
    if (!job) return reply(res, 404, { ok: false, error: "not_found" });
    if (TERMINAL_STATUSES.includes(job.status)) {
      return reply(res, 200, { ok: false, error: "job_finished", status: job.status });
    }
    job.status = "done";
    job.manifest = manifest;
    job.totals = totals;
    job.completedAt = easternIso(new Date());
    job.updatedAt = job.completedAt;
    await writeJobs(jobs);
    console.log(`[yt-archive] job ${job.id} completed (${manifest.length} catalog rows).`);
    return reply(res, 200, { ok: true, job });
  } catch (e) {
    console.error(`[yt-archive] complete FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
}

async function actionFail(req, res, body) {
  if (!gateSecret(req, res)) return;
  if (!gateStore(res)) return;
  const id = String(body.id || "");
  if (!id) return reply(res, 400, { ok: false, error: "id_required" });
  try {
    const jobs = await readJobs();
    const job = jobs.find(j => j.id === id) || null;
    if (!job) return reply(res, 404, { ok: false, error: "not_found" });
    if (TERMINAL_STATUSES.includes(job.status)) {
      return reply(res, 200, { ok: false, error: "job_finished", status: job.status });
    }
    job.status = "failed";
    job.error = String(body.error || "runner_error").slice(0, 500);
    job.updatedAt = easternIso(new Date());
    await writeJobs(jobs);
    console.log(`[yt-archive] job ${job.id} failed (${job.error}).`);
    return reply(res, 200, { ok: true, job });
  } catch (e) {
    console.error(`[yt-archive] fail FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
}

async function actionCancel(req, res, body) {
  if (!(await gateSession(req, res))) return;
  if (!gateStore(res)) return;
  const id = String(body.id || "");
  if (!id) return reply(res, 400, { ok: false, error: "id_required" });
  try {
    const jobs = await readJobs();
    const job = jobs.find(j => j.id === id) || null;
    if (!job) return reply(res, 404, { ok: false, error: "not_found" });
    if (job.status !== "queued") {
      return reply(res, 200, { ok: false, error: "not_queued", status: job.status });
    }
    job.status = "cancelled";
    job.updatedAt = easternIso(new Date());
    await writeJobs(jobs);
    console.log(`[yt-archive] job ${job.id} cancelled from the Desk.`);
    return reply(res, 200, { ok: true, job });
  } catch (e) {
    console.error(`[yt-archive] cancel FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  const q = queryOf(req);
  const body = req.method === "POST" ? await readBody(req) : {};
  const action = String(q.action || body.action || "");

  if (action === "jobs") return actionJobs(req, res);
  if (req.method !== "POST") return reply(res, 405, { ok: false, error: "method_not_allowed" });
  if (action === "queue") return actionQueue(req, res, body);
  if (action === "claim") return actionClaim(req, res, body);
  if (action === "progress") return actionProgress(req, res, body);
  if (action === "complete") return actionComplete(req, res, body);
  if (action === "fail") return actionFail(req, res, body);
  if (action === "cancel") return actionCancel(req, res, body);
  return reply(res, 400, { ok: false, error: "unknown_action" });
}

/* Exported for the local test suite (scripts/yt-archive.test.mjs);
   harmless in production. */
export const _internals = {
  JOBS_PATHNAME,
  QUALITIES,
  plausibleYoutubeUrl,
  cleanQuality,
  cleanProgress,
  cleanManifest,
  cleanTotals,
  validSession
};
