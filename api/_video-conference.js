/* =====================================================================
   IEC Suite Video Conference — Zoom-style ad-hoc video meetings from
   the private IEC back office (DrMorgan's order, 2026-11-26: "build
   like zoom room in my Suite so i can send invitation to join" —
   wired into the IEC Suite desk, his private back office).

   Shared helper (the leading underscore keeps Vercel from routing it
   as a function — this project is AT its function ceiling: a probe
   deploy on 2026-11-26 proved any 18th route file fails the build,
   whatever its content). api/demo-admin.js dispatches the vc-*
   actions here behind the same desk_session gate:

     { action: "vc-create", title? }   → meeting + host/guest links
     { action: "vc-list" }             → recent meetings
     { action: "vc-links", meetingId } → fresh host/guest links
     { action: "vc-end",   meetingId } → delete the Daily room

   Rooms are private Daily.co rooms (same Daily account as CURAVIA's
   video visits). Recording stays OFF (MA ch. 272 § 99 all-party
   consent). Links carry Daily meeting tokens (12h): the host link is
   the owner token; the guest invitation link needs no account.

   Meeting records (never tokens) persist in Vercel Blob at
   video-conference/meetings.json, same store as the Desk documents.

   Env (this Vercel project — iecincglobal-site):
     DAILY_API_KEY          Daily.co API key (fail-closed without it)
     BLOB_READ_WRITE_TOKEN  the Office Blob store (list persistence)
   ===================================================================== */

import crypto from "node:crypto";
import { put, list } from "@vercel/blob";

const BLOB_PATH = "video-conference/meetings.json";
const ROOM_TTL_SECONDS = 12 * 60 * 60;
const MAX_MEETINGS = 50;

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

/* ---- Actions (reply = demo-admin's reply(res, code, obj)) ---- */

function randomId() {
  const buf = new Uint8Array(6);
  crypto.webcrypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function vcCreate(res, body, reply) {
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

async function vcList(res, reply) {
  const meetings = await loadMeetings();
  return reply(res, 200, { ok: true, meetings: meetings.slice(0, MAX_MEETINGS) });
}

async function findMeeting(meetingId) {
  const meetings = await loadMeetings();
  return { meetings, meeting: meetings.find(m => m.meetingId === meetingId) || null };
}

async function vcLinks(res, body, reply) {
  const { meeting } = await findMeeting(String(body.meetingId || ""));
  if (!meeting) return reply(res, 404, { ok: false, error: "not_found", message: "Meeting not found." });
  if (meeting.status !== "open") return reply(res, 409, { ok: false, error: "ended", message: "This meeting has ended." });
  const links = await mintLinks(meeting);
  if (!links) return reply(res, 502, { ok: false, error: "provider_error", message: "Could not mint invitation links." });
  return reply(res, 200, { ok: true, meeting, ...links });
}

async function vcEnd(res, body, reply) {
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

/* Dispatch entry for api/demo-admin.js. Returns true when handled. */
export async function videoConferenceAction(action, body, res, reply) {
  if (action === "vc-create") { await vcCreate(res, body, reply); return true; }
  if (action === "vc-list") { await vcList(res, reply); return true; }
  if (action === "vc-links") { await vcLinks(res, body, reply); return true; }
  if (action === "vc-end") { await vcEnd(res, body, reply); return true; }
  return false;
}
