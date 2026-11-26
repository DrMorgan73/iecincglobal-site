/* =====================================================================
   IEC Suite Video Conference — Zoom-style ad-hoc video meetings from
   the private IEC back office (DrMorgan's order, 2026-11-26: "build
   like zoom room in my Suite so i can send invitation to join" —
   wired into the IEC Suite desk, his private back office).

   POST /api/video-conference  (JSON body, desk_session cookie required)
     { action: "create", title? }        → meeting + host/guest links
     { action: "list" }                  → recent meetings
     { action: "links", meetingId }      → fresh host/guest links
     { action: "end",   meetingId }      → delete the Daily room

   Rooms are private Daily.co rooms (same Daily account as CURAVIA's
   video visits). Recording stays OFF (MA ch. 272 § 99 all-party
   consent). Links carry Daily meeting tokens (12h): the host link is
   the owner token; the guest invitation link needs no account.

   Meeting records (never tokens) persist in Vercel Blob at
   video-conference/meetings.json, same store as the Desk documents.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET    HMAC key for the session cookie
     DAILY_API_KEY          Daily.co API key (fail-closed without it)
     BLOB_READ_WRITE_TOKEN  the Office Blob store (list persistence)
   ===================================================================== */

import crypto from "node:crypto";
import { put, list } from "@vercel/blob";

const BLOB_PATH = "video-conference/meetings.json";
const ROOM_TTL_SECONDS = 12 * 60 * 60;
const MAX_MEETINGS = 50;

/* ---- Session check (same scheme as api/demo-admin.js) ---- */

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

/* ---- Small helpers (mirroring api/demo-admin.js) ---- */

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return new Promise(resolve => {
    let data = "";
    if (typeof req.on !== "function") return resolve({});
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
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

/* ---- Daily.co ---- */

async function daily(path, method, body) {
  const apiKey = process.env.DAILY_API_KEY;
  const res = await fetch("https://api.daily.co" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function mintToken(roomName, userName, isOwner) {
  const r = await daily("/v1/meeting-tokens", "POST", {
    properties: {
      room_name: roomName,
      user_name: userName,
      is_owner: isOwner,
      exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS
    }
  });
  return r.ok && r.data && r.data.token ? String(r.data.token) : null;
}

async function mintLinks(meeting) {
  const hostToken = await mintToken(meeting.roomName, "DrMorgan", true);
  const guestToken = await mintToken(meeting.roomName, "Guest", false);
  if (!hostToken || !guestToken) return null;
  return {
    hostUrl: `${meeting.roomUrl}?t=${encodeURIComponent(hostToken)}`,
    guestUrl: `${meeting.roomUrl}?t=${encodeURIComponent(guestToken)}`
  };
}

/* ---- Meeting store (Vercel Blob, best-effort) ---- */

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function loadMeetings() {
  if (!blobConfigured()) return [];
  try {
    const { blobs } = await list({ prefix: BLOB_PATH });
    const hit = blobs.find(b => b.pathname === BLOB_PATH);
    if (!hit) return [];
    const r = await fetch(hit.url);
    if (!r.ok) return [];
    const parsed = JSON.parse(await r.text());
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`[video-conference] load FAILED: ${e && e.message}`);
    return [];
  }
}

async function saveMeetings(meetings) {
  if (!blobConfigured()) return false;
  try {
    await put(BLOB_PATH, JSON.stringify(meetings.slice(0, MAX_MEETINGS)), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return true;
  } catch (e) {
    console.error(`[video-conference] save FAILED: ${e && e.message}`);
    return false;
  }
}

/* ---- Actions ---- */

function randomId() {
  const buf = new Uint8Array(6);
  crypto.webcrypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function actionCreate(res, body) {
  if (!process.env.DAILY_API_KEY) {
    return reply(res, 503, { ok: false, error: "not_configured", message: "Video provider is not configured yet (DAILY_API_KEY missing on this project)." });
  }
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 120)
    : undefined;
  const meetingId = "vc_" + randomId();
  const roomName = "iec-" + meetingId; // opaque — no names in the room name
  const exp = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS;
  const created = await daily("/v1/rooms", "POST", {
    name: roomName,
    privacy: "private",
    properties: {
      exp,
      enable_recording: false, // MA ch. 272 § 99 — no recording without all-party consent
      enable_chat: true,
      lang: "en"
    }
  });
  if (!created.ok || !created.data || !created.data.url) {
    console.error(`[video-conference] room create FAILED: ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
    return reply(res, 502, { ok: false, error: "provider_error", message: "Could not create the video room. Please try again." });
  }
  const now = new Date();
  const meeting = {
    meetingId,
    ...(title ? { title } : {}),
    roomName,
    roomUrl: String(created.data.url),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ROOM_TTL_SECONDS * 1000).toISOString(),
    status: "open"
  };
  const meetings = await loadMeetings();
  meetings.unshift(meeting);
  await saveMeetings(meetings);
  const links = await mintLinks(meeting);
  if (!links) {
    return reply(res, 502, { ok: false, error: "provider_error", message: "Room created but invitation links could not be minted. Try Copy invite from the list." });
  }
  return reply(res, 201, { ok: true, meeting, ...links });
}

async function actionList(res) {
  const meetings = await loadMeetings();
  return reply(res, 200, { ok: true, meetings: meetings.slice(0, MAX_MEETINGS) });
}

async function findMeeting(meetingId) {
  const meetings = await loadMeetings();
  return { meetings, meeting: meetings.find(m => m.meetingId === meetingId) || null };
}

async function actionLinks(res, body) {
  const { meeting } = await findMeeting(String(body.meetingId || ""));
  if (!meeting) return reply(res, 404, { ok: false, error: "not_found", message: "Meeting not found." });
  if (meeting.status !== "open") return reply(res, 409, { ok: false, error: "ended", message: "This meeting has ended." });
  const links = await mintLinks(meeting);
  if (!links) return reply(res, 502, { ok: false, error: "provider_error", message: "Could not mint invitation links." });
  return reply(res, 200, { ok: true, meeting, ...links });
}

async function actionEnd(res, body) {
  const { meetings, meeting } = await findMeeting(String(body.meetingId || ""));
  if (!meeting) return reply(res, 404, { ok: false, error: "not_found", message: "Meeting not found." });
  if (meeting.status !== "open") return reply(res, 409, { ok: false, error: "ended", message: "This meeting has already ended." });
  try {
    await daily("/v1/rooms/" + encodeURIComponent(meeting.roomName), "DELETE");
  } catch (e) {
    // Best-effort: the room also expires on its own (12h).
  }
  meeting.status = "ended";
  meeting.endedAt = new Date().toISOString();
  await saveMeetings(meetings);
  return reply(res, 200, { ok: true, meeting });
}

/* ---- Handler ---- */

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { ok: false, error: "method_not_allowed" });

  const session = getCookie(req.headers && req.headers.cookie, "desk_session");
  if (!session || !(await validSession(session))) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }

  const body = await readBody(req);
  const action = String(body.action || "");
  if (action === "create") return actionCreate(res, body);
  if (action === "list") return actionList(res);
  if (action === "links") return actionLinks(res, body);
  if (action === "end") return actionEnd(res, body);
  return reply(res, 400, { ok: false, error: "unknown_action" });
}
