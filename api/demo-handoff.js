// IEC Suite -> demo handoff token minter (DrMorgan's order, 2026-11-17).
// GET /api/demo-handoff?aud=medexec|insnap|curavia|insnapp|iecdocs
//
// The Desk is single-user: a valid `desk_session` cookie IS DrMorgan.
// When the Demo Launcher (desk/demos.html) asks, this endpoint mints a
// short-lived (10-minute) ECDSA P-256 signed token identifying his demo
// account (drmohdmorgan@gmail.com) for ONE demo portal (the audience).
// The portal verifies the signature against the public key embedded in
// its gate, establishes his demo session, and sends him straight into
// the demo — no landing page, no sign-in screen. Arriving at a demo by
// any other path is completely unaffected.
//
// No valid Desk session -> 401, and the launcher simply keeps the plain
// demo links (fail-closed: the handoff is an added convenience, never a
// new way in — the private key exists only in this project's env).
//
// Env required:
//   DESK_SESSION_SECRET          - HMAC key for the session cookie
//   DEMO_HANDOFF_PRIVATE_KEY_JWK - ECDSA P-256 private key (JWK JSON)

export const config = { runtime: 'edge' };

const OWNER_EMAIL = 'drmohdmorgan@gmail.com';
const AUDIENCES = ['medexec', 'insnap', 'curavia', 'insnapp', 'iecdocs'];
const TOKEN_TTL_SECONDS = 600;

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = bytes => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Same validation scheme as middleware.js / api/demo-admin.js.
async function validSession(value) {
  const secret = process.env.DESK_SESSION_SECRET;
  if (!secret || !value) return false;
  const parts = String(value).split('.');
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = await hmacHex(secret, user + '.' + exp);
  return timingSafeEqual(sig, expected);
}

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async function handler(req) {
  if (req.method !== 'GET') return json({ ok: false, error: 'method' }, 405);

  const aud = new URL(req.url).searchParams.get('aud') || '';
  if (!AUDIENCES.includes(aud)) return json({ ok: false, error: 'aud' }, 400);

  const session = getCookie(req.headers.get('cookie'), 'desk_session');
  if (!(await validSession(session))) return json({ ok: false, error: 'auth' }, 401);

  const jwkRaw = process.env.DEMO_HANDOFF_PRIVATE_KEY_JWK || '';
  if (!jwkRaw) return json({ ok: false, error: 'not_configured' }, 503);
  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk', JSON.parse(jwkRaw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
    );
  } catch { return json({ ok: false, error: 'not_configured' }, 503); }

  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, email: OWNER_EMAIL, aud, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const input = 'v1.' + b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input));
  const token = input + '.' + b64url(new Uint8Array(sig));
  return json({ ok: true, token, exp: payload.exp }, 200);
}
