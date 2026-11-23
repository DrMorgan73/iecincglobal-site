/* =====================================================================
   IEC Suite — shared auth crypto for the Desk sign-in endpoints
   (shared helper; the leading underscore keeps Vercel from routing
   it as a function, the same convention as the other api/_*.js
   modules).

   Used by api/desk-login.js (credential-override verification),
   api/desk-recover.js (reset-token hashing) and api/desk-reset.js
   (new-password hashing + session issue). Everything runs on
   WebCrypto so the helpers work in the Edge runtime.

   Password storage (only ever for a password set through the
   recovery flow — the env credential in DESK_PASS remains the
   bootstrap credential and is never copied into the database):
     pass_salt  16 random bytes, hex
     pass_hash  HMAC-SHA256(DESK_SESSION_SECRET, salt + ':' + password)
   The session secret acts as a pepper: a database leak alone does
   not enable offline password guessing.
   ===================================================================== */

const enc = new TextEncoder();
const hexOf = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hexOf(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sha256Hex(data) {
  return hexOf(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

/* Constant-time string comparison (Edge-safe timingSafeEqual). */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return hexOf(buf);
}

export async function passwordHash(secret, salt, password) {
  return hmacHex(secret, salt + ':' + password);
}

export async function verifyPasswordHash(secret, salt, expectedHash, password) {
  if (!salt || !expectedHash || typeof password !== 'string') return false;
  const actual = await passwordHash(secret, salt, password);
  return timingSafeEqual(actual, expectedHash);
}

/* The desk_session cookie, byte-identical to the one api/desk-login.js
   has always issued (username.exp.hmac, 7 days, HttpOnly). */
export async function sessionCookie(username, secret) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const sig = await hmacHex(secret, username + '.' + exp);
  return 'desk_session=' + username + '.' + exp + '.' + sig +
    '; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure';
}
