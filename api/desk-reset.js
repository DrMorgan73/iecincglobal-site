// IEC Suite — set a new password from a recovery link (Vercel Edge
// Function). POST {token, password}.
//
// The token is the one emailed by api/desk-recover.js: only its
// SHA-256 is stored, it expires 30 minutes after issue, and a
// successful reset burns it (single-use). The new password is
// stored as a salted, peppered hash in the desk_credential table
// and becomes the Suite credential (api/desk-login.js verifies
// against it instead of the env password). On success the caller
// is signed in immediately with the standard desk_session cookie.
//
// Env: DESK_SESSION_SECRET, QUESTIONNAIRE_DATABASE_URL.

import { sha256Hex, randomHex, passwordHash, sessionCookie } from './_desk-auth.js';
import { getCredentialByTokenHash, setPasswordAndClearToken, dbConfigured } from './_desk-credential-store.js';

export const config = { runtime: 'edge' };

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...(headers || {}) }
  });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false }, 400); }
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (password.length < 12) return json({ ok: false, error: 'password_too_short' }, 400);
  if (!token || !dbConfigured()) return json({ ok: false }, 401);

  const secret = process.env.DESK_SESSION_SECRET || '';
  if (!secret) return json({ ok: false }, 401);

  let row = null;
  try {
    row = await getCredentialByTokenHash(await sha256Hex(token));
  } catch {
    return json({ ok: false }, 401);
  }
  if (!row || !row.token_expires) return json({ ok: false }, 401);
  if (new Date(row.token_expires).getTime() < Date.now()) return json({ ok: false }, 401);

  const salt = randomHex(16);
  const hash = await passwordHash(secret, salt, password);
  try {
    await setPasswordAndClearToken(row.username, salt, hash);
  } catch {
    return json({ ok: false }, 401);
  }

  const cookie = await sessionCookie(row.username, secret);
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}
