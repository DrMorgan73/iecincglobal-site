// IEC Suite private gate — Vercel Edge Middleware.
// The public home page (welcome.html) is served at "/" for visitors.
// The Suite (index.html at "/") and "/desk/*" stay behind sign-in:
// unauthenticated visitors there are redirected to /desk/login.html.
// Corporate pages are untouched (they never match the matcher below).
// On the partners.* host the same middleware serves the Partner Portal
// front door at the root ("/" EN, "/es" ES) — see the handler below.
//
// Env required: DESK_SESSION_SECRET (HMAC key for the session cookie).

export const config = { matcher: ['/', '/index.html', '/es', '/es/', '/desk/:path*'] };

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

async function servePage(request, path) {
  const res = await fetch(new URL(path, request.url));
  // The sub-fetch transparently decodes the body, but the original
  // content-encoding/content-length headers survive on the Response.
  // Strip them so browsers don't try to decode an already-decoded body
  // (that mismatch caused "cannot decode raw data" in Safari).
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url);
  // The standalone Partner Portal lives on its own host. Its front door
  // is served AT THE ROOT of that host (no /partners/ redirect): the EN
  // door at "/" and the ES door at "/es". The ES door cannot be a plain
  // vercel.json rewrite — the marketing site's es/index.html shadows it
  // on the filesystem — so both doors are served here, where middleware
  // runs before filesystem and rewrites. Every other partners-host
  // request passes straight through; portal access is gated by the
  // partner's own activation/session, never by the Suite sign-in.
  const host = request.headers.get('host') || '';
  if (host.startsWith('partners.')) {
    if (pathname === '/' || pathname === '/index.html') {
      return servePage(request, '/partners/index.html');
    }
    if (pathname === '/es' || pathname === '/es/') {
      return servePage(request, '/es/partners/index.html');
    }
    return undefined;
  }
  // The marketing ES home at /es on the main host is untouched.
  if (pathname === '/es' || pathname === '/es/') return undefined;
  // The sign-in page itself must stay public.
  if (pathname === '/desk/login.html') return undefined;
  // The password-reset page (reached from the emailed recovery link)
  // must stay public too; the reset itself is gated by the token.
  if (pathname === '/desk/reset.html') return undefined;
  const session = getCookie(request.headers.get('cookie'), 'desk_session');
  if (session && (await validSession(session))) return undefined;
  // Public visitors get the public home page at the root.
  // The Suite sign-in stays one click away via "Team sign-in".
  if (pathname === '/' || pathname === '/index.html') {
    return servePage(request, '/welcome.html');
  }
  return Response.redirect(new URL('/desk/login.html', request.url));
}
