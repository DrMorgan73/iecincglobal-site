// Morgan Desk private gate — Vercel Edge Middleware.
// Protects "/" and "/desk/*". Unauthenticated visitors are redirected to
// the sign-in page at /desk/login.html. Corporate pages are untouched
// (they never match the matcher below).
//
// Env required: DESK_SESSION_SECRET (HMAC key for the session cookie).

export const config = { matcher: ['/', '/index.html', '/desk/:path*'] };

const enc = new TextEncoder();

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
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

async function validSession(value) {
  const secret = process.env.DESK_SESSION_SECRET;
  if (!secret) return false;
  const parts = String(value).split('.');
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = await hmacHex(secret, user + '.' + exp);
  return timingSafeEqual(sig, expected);
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);
  // The sign-in page itself must stay public.
  if (pathname === '/desk/login.html') return undefined;
  const session = getCookie(request.headers.get('cookie'), 'desk_session');
  if (session && (await validSession(session))) return undefined;
  return Response.redirect(new URL('/desk/login.html', request.url));
}
