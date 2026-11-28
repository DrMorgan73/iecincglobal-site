/* Local test suite for api/_podcast-cameras.js (Podcast Mixer
   wireless cameras) through the real api/demo-admin.js handler.
   Daily.co is mocked at the fetch boundary; the session store runs
   against the in-memory Blob mock. No real rooms, no real tokens.

   Run: node scripts/podcast-cameras.test.mjs   (exit 1 on any failure) */

import crypto from "node:crypto";
import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";
delete process.env.DAILY_API_KEY;

const cameras = await import("../api/_podcast-cameras.js");
const { default: handler } = await import("../api/demo-admin.js");

/* ---------------- tiny harness ---------------- */
let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log("PASS  " + name + (detail ? " — " + detail : "")); }
  else { failed++; console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/* ---------------- pure helpers ---------------- */
check("normalizeCode uppercases", cameras.normalizeCode("abc234") === "ABC234");
check("normalizeCode strips spaces/dashes", cameras.normalizeCode(" ab-c 234 ") === "ABC234");
check("normalizeCode rejects short", cameras.normalizeCode("ABC23") === "");
check("normalizeCode rejects long", cameras.normalizeCode("ABC2345") === "");
check("normalizeCode rejects ambiguous 0/O/1/I/L", cameras.normalizeCode("ABCO10") === "" && cameras.normalizeCode("ABCIL2") === "");
check("normalizeCode rejects empty/null", cameras.normalizeCode("") === "" && cameras.normalizeCode(null) === "");
{
  const code = cameras.generateCode(() => new Uint8Array([0, 1, 2, 3, 4, 5]));
  check("generateCode deterministic alphabet", code === "ABCDEF", code);
  const real = cameras.generateCode();
  check("generateCode shape", /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(real), real);
}
check("slot model is Cam 2-5, max 4", eq(cameras.SLOT_NUMBERS, [2, 3, 4, 5]) && cameras.MAX_WIRELESS === 4);
check("slotLabel", cameras.slotLabel(3) === "Cam 3");
{
  const now = Date.now();
  const sessions = [
    { sessionId: "s1", status: "ended", expiresAt: new Date(now + 60000).toISOString(), slots: [{ slot: 2, code: "AAAAAA" }] },
    { sessionId: "s2", status: "open", expiresAt: new Date(now - 60000).toISOString(), slots: [{ slot: 3, code: "BBBBBB" }] },
    { sessionId: "s3", status: "open", expiresAt: new Date(now + 60000).toISOString(), slots: [{ slot: 4, code: "CCCCCC" }] }
  ];
  check("findSessionByCode finds open session + slot", eq(cameras.findSessionByCode(sessions, "CCCCCC", now), { session: sessions[2], slot: 4 }));
  check("findSessionByCode skips ended", cameras.findSessionByCode(sessions, "AAAAAA", now) === null);
  check("findSessionByCode skips expired", cameras.findSessionByCode(sessions, "BBBBBB", now) === null);
  check("findSessionByCode unknown code", cameras.findSessionByCode(sessions, "ZZZZZZ", now) === null);
  check("findSessionByCode empty code", cameras.findSessionByCode(sessions, "", now) === null);
}

/* ---------------- fetch mock (Daily + blob URLs) ---------------- */
const dailyCalls = [];
let tokenSeq = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://blob.mock/")) {
    const pathname = u.slice("https://blob.mock/".length);
    const rec = blobMock.__blobs.get(pathname);
    if (!rec) return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    return { ok: true, status: 200, json: async () => JSON.parse(rec.content), text: async () => rec.content };
  }
  if (u.startsWith("https://api.daily.co")) {
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    dailyCalls.push({ url: u, method, body });
    if (u.endsWith("/v1/rooms") && method === "POST") {
      return { ok: true, status: 200, json: async () => ({ url: "https://curavia.daily.co/" + body.name, name: body.name }), text: async () => "" };
    }
    if (u.endsWith("/v1/meeting-tokens") && method === "POST") {
      tokenSeq++;
      return { ok: true, status: 200, json: async () => ({ token: "daily-token-" + tokenSeq }), text: async () => "" };
    }
    if (u.includes("/v1/rooms/") && method === "DELETE") {
      return { ok: true, status: 200, json: async () => ({ deleted: true }), text: async () => "" };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  }
  throw new Error("unexpected fetch: " + u);
};

/* ---------------- handler driver ---------------- */
function sessionCookie(user = "drmorgan") {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sig = crypto.createHmac("sha256", SECRET).update(user + "." + exp).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}
async function call(body, { cookie } = {}) {
  let status = 0, payload = null;
  const req = {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body
  };
  const res = {
    status(code) { status = code; return this; },
    json(obj) { payload = obj; return this; },
    setHeader() {},
    end(text) { payload = JSON.parse(text || "{}"); }
  };
  await handler(req, res);
  return { status, payload };
}

/* ---------------- auth gate intact ---------------- */
{
  const r = await call({ action: "cam-create" });
  check("cam-create without session → 401", r.status === 401 && r.payload.error === "unauthorized");
  const r2 = await call({ action: "list" });
  check("list without session → 401 (gate intact)", r2.status === 401);
  const r3 = await call({ action: "cam-end", sessionId: "x" });
  check("cam-end without session → 401", r3.status === 401);
}

/* ---------------- fail-closed without DAILY_API_KEY ---------------- */
{
  const r = await call({ action: "cam-create" }, { cookie: sessionCookie() });
  check("cam-create without DAILY_API_KEY → 503 not_configured", r.status === 503 && r.payload.error === "not_configured" && /DAILY_API_KEY/.test(r.payload.message));
  const r2 = await call({ action: "cam-join", code: "ABC234" });
  check("cam-join without DAILY_API_KEY → 503 not_configured", r2.status === 503 && r2.payload.error === "not_configured");
  check("no Daily calls made while unconfigured", dailyCalls.length === 0);
}

/* ---------------- create → join → end ---------------- */
process.env.DAILY_API_KEY = "daily-test-key";
let created;
{
  const r = await call({ action: "cam-create" }, { cookie: sessionCookie() });
  created = r.payload;
  check("cam-create → 201", r.status === 201 && r.payload.ok === true);
  check("cam-create returns owner token", typeof r.payload.ownerToken === "string" && r.payload.ownerToken.startsWith("daily-token-"));
  check("cam-create returns 4 slots Cam 2-5", eq(r.payload.slots.map(s => s.slot), [2, 3, 4, 5]) && eq(r.payload.slots.map(s => s.label), ["Cam 2", "Cam 3", "Cam 4", "Cam 5"]));
  const codes = r.payload.slots.map(s => s.code);
  check("slot codes unique + well-formed", new Set(codes).size === 4 && codes.every(c => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(c)), codes.join(","));
  const roomCall = dailyCalls.find(c => c.url.endsWith("/v1/rooms") && c.method === "POST");
  check("room is private, recording OFF, chat/screenshare OFF, 12h exp",
    roomCall && roomCall.body.privacy === "private" &&
    roomCall.body.properties.enable_recording === false &&
    roomCall.body.properties.enable_chat === false &&
    roomCall.body.properties.enable_screenshare === false &&
    Math.abs(roomCall.body.properties.exp - (Math.floor(Date.now() / 1000) + 12 * 3600)) < 60);
  const ownerMint = dailyCalls.find(c => c.url.endsWith("/v1/meeting-tokens") && c.body.properties.is_owner === true);
  check("owner token minted for Mixer", !!ownerMint && ownerMint.body.properties.user_name === "Mixer");
  const stored = JSON.parse(blobMock.__blobs.get("podcast-cameras/sessions.json").content);
  check("session persisted without any token", stored.length === 1 && !JSON.stringify(stored).includes("daily-token-") && stored[0].status === "open");
}
{
  const code = created.slots[1].code; // Cam 3
  const before = dailyCalls.length;
  const r = await call({ action: "cam-join", code });
  check("cam-join (no session) → 200 with slot + label", r.status === 200 && r.payload.slot === 3 && r.payload.label === "Cam 3" && r.payload.roomUrl === created.session.roomUrl);
  check("cam-join returns a fresh camera token", typeof r.payload.token === "string" && r.payload.token.startsWith("daily-token-"));
  const mint = dailyCalls.slice(before).find(c => c.url.endsWith("/v1/meeting-tokens"));
  check("camera token is non-owner, named for the slot", !!mint && mint.body.properties.is_owner === false && mint.body.properties.user_name === "Cam 3");
  const r2 = await call({ action: "cam-join", code: code.toLowerCase().replace(/(.{3})/, "$1-") });
  check("cam-join accepts lowercase + dash", r2.status === 200 && r2.payload.slot === 3);
  const r3 = await call({ action: "cam-join", code: "ZZZZZZ" });
  check("cam-join unknown code → 404 generic", r3.status === 404 && r3.payload.error === "invalid_code");
  const r4 = await call({ action: "cam-join", code: "nope" });
  check("cam-join malformed code → 404 generic", r4.status === 404 && r4.payload.error === "invalid_code");
  const r5 = await call({ action: "cam-join" });
  check("cam-join missing code → 404 generic", r5.status === 404);
}
{
  const r = await call({ action: "cam-end", sessionId: created.session.sessionId }, { cookie: sessionCookie() });
  check("cam-end → 200", r.status === 200 && r.payload.session.status === "ended");
  check("cam-end deletes the Daily room", dailyCalls.some(c => c.method === "DELETE" && c.url.includes("/v1/rooms/iec-cam_")));
  const r2 = await call({ action: "cam-end", sessionId: created.session.sessionId }, { cookie: sessionCookie() });
  check("second cam-end → 409", r2.status === 409);
  const r3 = await call({ action: "cam-join", code: created.slots[0].code });
  check("cam-join after end → 404 (code dead)", r3.status === 404);
  const r4 = await call({ action: "cam-end", sessionId: "cam_missing" }, { cookie: sessionCookie() });
  check("cam-end unknown session → 404", r4.status === 404);
}
{
  const r = await call({ action: "cam-bogus" }, { cookie: sessionCookie() });
  check("unknown cam-* action → 400", r.status === 400 && r.payload.error === "unknown_action");
  const r2 = await call({ action: "bogus" }, { cookie: sessionCookie() });
  check("unknown action → 400 (dispatch intact)", r2.status === 400);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
