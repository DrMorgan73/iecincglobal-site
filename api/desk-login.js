// IEC Suite sign-in — Vercel Edge Function.
// POST {username, password} as JSON. Compares against env credentials using a
// constant-time comparison and, on success, sets the signed `desk_session`
// cookie (HttpOnly, 7 days).
//
// Env required:
//   DESK_USER           - the sign-in username
//   DESK_PASS           - the sign-in password (plaintext; stored in Vercel env vars)
//   DESK_SESSION_SECRET - HMAC key for the session cookie (long random string)
//
// Note: the Edge Runtime exposes WebCrypto (no Node crypto.timingSafeEqual),
// so the constant-time comparison below is implemented on raw char codes.

export const config = { runtime: 'edge' };

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// Constant-time string comparison (Edge-safe equivalent of timingSafeEqual).
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false }, 400); }

  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();
  const expUser = (process.env.DESK_USER || '').trim();
  const expPass = (process.env.DESK_PASS || '').trim();
  const secret = process.env.DESK_SESSION_SECRET || '';

  let ok = false;
  if (username && password && expUser && expPass && secret &&
      /^[A-Za-z0-9_.@-]{1,64}$/.test(username)) {
    ok = timingSafeEqual(username, expUser) && timingSafeEqual(password, expPass);
  }
  if (!ok) return json({ ok: false }, 401);

  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days
  const sig = await hmacHex(secret, username + '.' + exp);
  const cookie = 'desk_session=' + username + '.' + exp + '.' + sig +
    '; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure';

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie }
  });
}
