/* =====================================================================
   IEC Contractor Portal — CONTRACTOR ACCESS TOKENS.
   ---------------------------------------------------------------------
   Contractors are EXTERNAL people: they never hold the shared Desk
   credential (DESK_USER / DESK_PASS) and never get a Desk session —
   that credential opens the whole internal Desk (CRM, deals, demo
   users, vault). Contractor access mirrors the DEMO activation-link
   model instead (see api/demo-admin.js): IEC invites the contractor,
   the contractor follows a ONE-TIME activation link, and the link
   sets a signed, HttpOnly cookie scoped to that contractor only.

   Token format mirrors middleware.js exactly: `<id>.<exp>.<sig>`
   where sig = HMAC-SHA256(secret, `<id>.<exp>`), timing-safe
   compared. Two token kinds share the format and the secret:
     - activation token: single-use, stored hashed in the
       contractors table, consumed on first activation;
     - session cookie: `contractor_session`, 30 days, re-issued on
       each activation only (no silent renewal).

   Env required: CONTRACTOR_PORTAL_SECRET (long random string, set
   in the Vercel project — never in the repo, never in a page).
   With no secret configured every auth check fails closed.
   ===================================================================== */

import crypto from 'node:crypto';

const COOKIE_NAME = 'contractor_session';
const SESSION_DAYS = 30;

/* Partner client-link attribution cookie: opening a partner's
   public client link (…/r/<code>) sets this signed cookie holding
   the partner CODE (the token's id slot carries the code, not a
   contractor id), so a registration completed on any IEC page
   within the credit window is credited to that partner. The
   window mirrors the channel rule IEC works under: 3 days. The
   cookie is HttpOnly — the questionnaire endpoint reads it
   server-side; page scripts never touch it. Same-device /
   same-browser limits apply and are documented as such. */
const ATTRIBUTION_COOKIE_NAME = 'iec_partner_link';
const ATTRIBUTION_DAYS = 3;

function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function portalSecret() {
  return process.env.CONTRACTOR_PORTAL_SECRET || '';
}

/* Mint `<id>.<exp>.<sig>`. `ttlSeconds` bounds the token; activation
   tokens use a short TTL (7 days), session cookies 30 days. */
export function mintToken(id, ttlSeconds) {
  const secret = portalSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmacHex(secret, `${id}.${exp}`);
  return `${id}.${exp}.${sig}`;
}

export function mintActivationToken(contractorId) {
  return mintToken(contractorId, 7 * 24 * 3600);
}

export function mintSessionToken(contractorId) {
  return mintToken(contractorId, SESSION_DAYS * 24 * 3600);
}

/* ---- partner credentials (Nov 23, 2026) ----
   The activation token above is a FIRST-TIME signup mechanism.
   Recurrent sign-in is a username + password the partner sets
   himself: the username is stored normalized (trimmed,
   lowercased) and matched case-insensitively; the password is
   a scrypt hash + per-partner salt, never stored or logged in
   plaintext. Sessions minted for credential sign-ins carry the
   partner's session epoch in the id slot ("<id>-x<epoch>") so a
   password reset — which bumps the epoch — kills every
   outstanding session for that partner. Tokens minted before
   the epoch existed carry the bare id and parse as epoch 0:
   they live only while the stored epoch is still 0. */

export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function usernameOk(value) {
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalizeUsername(value));
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  let stored;
  try { stored = Buffer.from(String(hash), 'hex'); } catch { return false; }
  if (!stored.length) return false;
  const calc = crypto.scryptSync(String(password), String(salt), stored.length);
  return crypto.timingSafeEqual(calc, stored);
}

export function mintPartnerSessionToken(contractorId, epoch) {
  const e = Number.isInteger(epoch) && epoch > 0 ? epoch : 0;
  return mintToken(`${contractorId}-x${e}`, SESSION_DAYS * 24 * 3600);
}

/* Split a verified session token's id slot into the contractor
   id and the epoch it was minted at. A bare id (a token minted
   before epochs) parses as epoch 0. Contractor ids are UUIDs —
   the "-x<digits>" suffix can only be the epoch marker. */
export function parsePartnerSessionId(idSlot) {
  const s = String(idSlot || '');
  const m = s.match(/^(.*)-x(\d+)$/);
  if (m) return { contractorId: m[1], epoch: Number(m[2]) };
  return { contractorId: s, epoch: 0 };
}

/* Signing token (Nov 25, 2026 — sign-from-link): the 24h
   single-purpose token a new partner holds while he signs the
   CNDA and the Agreement on the public /sign page. Purpose
   isolation is structural, not a flag: the token's id slot
   carries a '-sgn' suffix, so it can never resolve as a
   session (the session lookup reads a contractor id that does
   not exist) and never as an activation token (the activation
   resolver compares against a different stored hash AND reads
   a contractor id that does not exist). Only the signing
   resolver — which strips the suffix and compares against
   signing_token_hash — accepts it. */
export function mintSigningToken(contractorId, ttlSeconds = 24 * 3600) {
  /* The random nonce makes every mint unique — two sign-starts
     inside the same second must still rotate the credential,
     so a superseded signing token is always dead. */
  const nonce = crypto.randomBytes(4).toString('hex');
  return mintToken(`${contractorId}-sgn-${nonce}`, ttlSeconds);
}
export function parseSigningId(idSlot) {
  const m = /^(.*)-sgn-[0-9a-f]{8}$/.exec(String(idSlot || ''));
  return m ? (m[1] || null) : null;
}

/* Verify `<id>.<exp>.<sig>` and return the id, or null. Fails closed
   on a missing secret, a malformed token, an expired token, or a
   bad signature. Never throws. */
export function verifyToken(raw) {
  try {
    const secret = portalSecret();
    if (!secret || typeof raw !== 'string') return null;
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [id, exp, sig] = parts;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return null;
    if (!timingSafeEqual(hmacHex(secret, `${id}.${exp}`), sig)) return null;
    return id;
  } catch {
    return null;
  }
}

/* One-way hash of an activation token for storage: the raw token is
   never stored (it travels only in the activation link). */
export function hashToken(raw) {
  const secret = portalSecret();
  if (!secret || !raw) return '';
  return crypto.createHash('sha256').update(`${secret}:${raw}`).digest('hex');
}

export function getCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

/* The contractor id from a valid session cookie, or null. */
export function contractorFromRequest(req) {
  return verifyToken(getCookie(req, COOKIE_NAME));
}

export function sessionCookieHeader(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

/* Mint the 3-day attribution token for one partner code. */
export function mintAttributionToken(code) {
  return mintToken(String(code || '').toUpperCase(), ATTRIBUTION_DAYS * 24 * 3600);
}

/* The partner code carried by a request's attribution cookie, or
   null (no cookie, expired, or forged). */
export function attributionCodeFromRequest(req) {
  const code = verifyToken(getCookie(req, ATTRIBUTION_COOKIE_NAME));
  return code ? String(code).toUpperCase() : null;
}

export function attributionCookieHeader(token) {
  return `${ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${ATTRIBUTION_DAYS * 24 * 3600}; HttpOnly; SameSite=Lax; Secure`;
}

export const _internals = { COOKIE_NAME, SESSION_DAYS, ATTRIBUTION_COOKIE_NAME, ATTRIBUTION_DAYS, hmacHex, timingSafeEqual };
