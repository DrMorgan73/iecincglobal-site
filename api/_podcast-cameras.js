/* =====================================================================
   IEC Podcast Mixer — Wireless Cameras (DrMorgan's order,
   2026-11-28: "build our own camera application" — in the mixer,
   up to four cameras, wireless).

   Why this exists: macOS camera sharing (Continuity Camera) would
   not offer the iPhone/iPad cameras to the Mac, and the OBS + NDI
   route proved fragile. This replaces both: each phone opens
   /camera-7rgiz4s1du.html in its own browser and sends its camera straight
   into the mixer's Daily room over the network. No macOS camera
   sharing, no OBS, no NDI, no third-party camera app, no Mac
   control. The mixer receives the feeds as ordinary video tracks
   and composites/records them exactly like its local cameras.

   Shared helper (the leading underscore keeps Vercel from routing
   it as a function — this project is AT its function ceiling).
   api/demo-admin.js dispatches the cam-* actions here:

     { action: "cam-create" }        → session + mixer owner token
                                        + 4 slot codes  [desk_session]
     { action: "cam-join", code }    → camera token for that slot
                                        [public: the code IS the
                                        credential — phones carry no
                                        desk_session cookie]
     { action: "cam-end", sessionId } → delete the Daily room
                                        [desk_session]

   Rooms are private Daily.co rooms (same Daily account as the IEC
   Suite Video Conference). Recording stays OFF on Daily — the
   mixer records locally in the browser, as it always has. Tokens
   are minted server-side only and never stored: session records
   (Blob, podcast-cameras/sessions.json) hold room + codes only.

   Slot model: the Mac's own camera is Cam 1 (the mixer's existing
   local path). The four wireless slots are Cam 2–Cam 5. A code is
   bound to one slot; the first phone to join takes the first free
   slot in the mixer UI, and the mixer can rename/reassign/drop.

   Env (this Vercel project — iecincglobal-site):
     DAILY_API_KEY          Daily.co API key (fail-closed without it)
     BLOB_READ_WRITE_TOKEN  the Office Blob store (session records)
   ===================================================================== */

import crypto from "node:crypto";
import { put, list } from "@vercel/blob";

const BLOB_PATH = "podcast-cameras/sessions.json";
const ROOM_TTL_SECONDS = 12 * 60 * 60;
const MAX_SESSIONS = 50;
export const MAX_WIRELESS = 4;
/* Wireless slot numbers: the Mac's local camera is Cam 1. */
export const SLOT_NUMBERS = [2, 3, 4, 5];

/* Unambiguous alphabet (no 0/O/1/I/L) — codes get read aloud and
   typed on phones. 31^6 ≈ 887M combinations per session. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export function generateCode(randomBytes) {
  const buf = randomBytes
    ? randomBytes(CODE_LENGTH)
    : crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  }
  return out;
}

/* Phones type codes by hand: accept any case, ignore spaces and
   dashes. Returns "" for anything that is not exactly CODE_LENGTH
   alphabet characters — the join action treats that as unknown. */
export function normalizeCode(raw) {
  const cleaned = String(raw || "").toUpperCase().replace(/[\s-]+/g, "");
  if (cleaned.length !== CODE_LENGTH) return "";
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return "";
  }
  return cleaned;
}

export function slotLabel(slot) {
  return "Cam " + slot;
}

/* Find the open, unexpired session holding `code` (already
   normalized) and which slot it belongs to. Pure — unit-tested. */
export function findSessionByCode(sessions, code, nowMs) {
  if (!code) return null;
  for (const s of sessions || []) {
    if (!s || s.status !== "open") continue;
    if (s.expiresAt && Date.parse(s.expiresAt) <= nowMs) continue;
    const hit = (s.slots || []).find(sl => sl && sl.code === code);
    if (hit) return { session: s, slot: hit.slot };
  }
  return null;
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

/* ---- Session store (Vercel Blob, best-effort) ---- */

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function loadSessions() {
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
    console.error(`[podcast-cameras] load FAILED: ${e && e.message}`);
    return [];
  }
}

async function saveSessions(sessions) {
  if (!blobConfigured()) return false;
  try {
    await put(BLOB_PATH, JSON.stringify(sessions.slice(0, MAX_SESSIONS)), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return true;
  } catch (e) {
    console.error(`[podcast-cameras] save FAILED: ${e && e.message}`);
    return false;
  }
}

/* ---- Actions (reply = demo-admin's reply(res, code, obj)) ---- */

function randomId() {
  const buf = new Uint8Array(6);
  crypto.webcrypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
}

function notConfigured(res, reply) {
  return reply(res, 503, {
    ok: false,
    error: "not_configured",
    message: "Wireless cameras are not configured yet (DAILY_API_KEY missing on this project)."
  });
}

async function camCreate(res, reply) {
  if (!process.env.DAILY_API_KEY) return notConfigured(res, reply);
  if (!blobConfigured()) {
    /* Without the store, codes could never be looked up by phones —
       fail honestly instead of minting a session nobody can join. */
    return reply(res, 503, {
      ok: false,
      error: "not_configured",
      message: "Wireless cameras are not configured yet (session store missing on this project)."
    });
  }
  const sessionId = "cam_" + randomId();
  const roomName = "iec-" + sessionId; // opaque — no names in the room name
  const exp = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS;
  const created = await daily("/v1/rooms", "POST", {
    name: roomName,
    privacy: "private",
    properties: {
      exp,
      enable_recording: false, // the mixer records locally in the browser
      enable_chat: false,
      enable_screenshare: false,
      lang: "en"
    }
  });
  if (!created.ok || !created.data || !created.data.url) {
    console.error(`[podcast-cameras] room create FAILED: ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
    return reply(res, 502, { ok: false, error: "provider_error", message: "Could not create the camera room. Please try again." });
  }
  const ownerToken = await mintToken(roomName, "Mixer", true);
  if (!ownerToken) {
    return reply(res, 502, { ok: false, error: "provider_error", message: "Camera room created but the mixer token could not be minted. Please try again." });
  }
  /* One unique code per slot. */
  const used = new Set();
  const slots = SLOT_NUMBERS.map(slot => {
    let code = generateCode();
    while (used.has(code)) code = generateCode();
    used.add(code);
    return { slot, code };
  });
  const now = new Date();
  const session = {
    sessionId,
    roomName,
    roomUrl: String(created.data.url),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ROOM_TTL_SECONDS * 1000).toISOString(),
    status: "open",
    slots
  };
  const sessions = await loadSessions();
  sessions.unshift(session);
  const saved = await saveSessions(sessions);
  if (!saved) {
    return reply(res, 502, { ok: false, error: "store_failed", message: "Camera session could not be saved. Please try again." });
  }
  return reply(res, 201, {
    ok: true,
    session: { sessionId, roomUrl: session.roomUrl, expiresAt: session.expiresAt },
    ownerToken,
    slots: slots.map(s => ({ slot: s.slot, label: slotLabel(s.slot), code: s.code }))
  });
}

/* PUBLIC (no desk_session): the code is the credential. It is
   session-scoped, expires with the room (12h), and grants only a
   non-owner camera token for one slot. Unknown, expired, and ended
   codes all answer the same 404 — nothing leaks which case hit. */
async function camJoin(res, body, reply) {
  if (!process.env.DAILY_API_KEY) return notConfigured(res, reply);
  const code = normalizeCode(body.code);
  if (!code) {
    return reply(res, 404, { ok: false, error: "invalid_code", message: "That code was not recognized. Check the code in the mixer and try again." });
  }
  const sessions = await loadSessions();
  const hit = findSessionByCode(sessions, code, Date.now());
  if (!hit) {
    return reply(res, 404, { ok: false, error: "invalid_code", message: "That code was not recognized. Check the code in the mixer and try again." });
  }
  const token = await mintToken(hit.session.roomName, slotLabel(hit.slot), false);
  if (!token) {
    return reply(res, 502, { ok: false, error: "provider_error", message: "Could not join the camera room. Please try again." });
  }
  return reply(res, 200, {
    ok: true,
    roomUrl: hit.session.roomUrl,
    token,
    slot: hit.slot,
    label: slotLabel(hit.slot)
  });
}

async function camEnd(res, body, reply) {
  const sessions = await loadSessions();
  const session = sessions.find(s => s.sessionId === String(body.sessionId || "")) || null;
  if (!session) return reply(res, 404, { ok: false, error: "not_found", message: "Camera session not found." });
  if (session.status !== "open") return reply(res, 409, { ok: false, error: "ended", message: "This camera session has already ended." });
  try {
    await daily("/v1/rooms/" + encodeURIComponent(session.roomName), "DELETE");
  } catch (e) {
    // Best-effort: the room also expires on its own (12h).
  }
  session.status = "ended";
  session.endedAt = new Date().toISOString();
  await saveSessions(sessions);
  return reply(res, 200, { ok: true, session: { sessionId: session.sessionId, status: session.status } });
}

/* Dispatch entry for api/demo-admin.js. Returns true when handled.
   cam-create / cam-end sit behind the desk_session gate there;
   cam-join is dispatched before it (code = credential). */
export async function podcastCamerasAction(action, body, res, reply) {
  if (action === "cam-create") { await camCreate(res, reply); return true; }
  if (action === "cam-join") { await camJoin(res, body, reply); return true; }
  if (action === "cam-end") { await camEnd(res, body, reply); return true; }
  return false;
}
