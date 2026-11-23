// IEC Suite — forgot-password recovery request (Vercel Edge Function).
// POST {username}. ALWAYS answers the same generic 200 (no account
// enumeration): if the username matches the Suite account, a
// single-use recovery link (30-minute expiry) is emailed to the
// office mailbox of record, info@iecincglobal.com — the only
// mailbox associated with this single-credential sign-in.
//
// The token itself is never stored: only its SHA-256 lands in the
// desk_credential table (api/_desk-credential-store.js). Opening
// the link leads to /desk/reset.html, which posts to
// api/desk-reset.js.
//
// Env: DESK_USER, DESK_SESSION_SECRET (token signing context),
// QUESTIONNAIRE_DATABASE_URL (credential store),
// DEMO_ADMIN_RESEND_API_KEY (the project's Resend sending key).

import { timingSafeEqual, sha256Hex, randomHex } from './_desk-auth.js';
import { setResetToken, dbConfigured } from './_desk-credential-store.js';

export const config = { runtime: 'edge' };

const RECOVERY_EMAIL = 'info@iecincglobal.com';
const RESET_BASE = 'https://iecincglobal.com/desk/reset.html';

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function sendRecoveryEmail(link) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || '';
  if (!key) return false;
  const text = [
    'A password recovery was requested for the IEC Suite sign-in.',
    '',
    'Open this link within 30 minutes to choose a new password:',
    link,
    '',
    'The link works once. If you did not request it, ignore this email — nothing changes.',
    '',
    'IEC, Inc. · info@iecincglobal.com'
  ].join('\n');
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.55">',
    '<p>A password recovery was requested for the <strong>IEC Suite</strong> sign-in.</p>',
    '<p>Open this link within 30 minutes to choose a new password:</p>',
    `<p style="margin:22px 0"><a href="${link}" style="background:#1a3a5c;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:4px;font-weight:bold">Choose a new password</a></p>`,
    `<p style="font-size:12px;color:#555555">If the button does not open, use this link:<br><a href="${link}">${link}</a></p>`,
    '<p>The link works once. If you did not request it, ignore this email — nothing changes.</p>',
    '<p>IEC, Inc. · info@iecincglobal.com</p>',
    '</div>'
  ].join('');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'IEC, Inc. <info@iecincglobal.com>',
        to: [RECOVERY_EMAIL],
        subject: 'IEC Suite — password recovery',
        text, html
      })
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  let username = '';
  try {
    const body = await req.json();
    username = String(body.username || '').trim();
  } catch { /* malformed body: same generic answer */ }

  const expUser = (process.env.DESK_USER || '').trim();
  try {
    if (username && expUser && dbConfigured() && timingSafeEqual(username, expUser)) {
      const token = randomHex(32);
      const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await setResetToken(expUser, await sha256Hex(token), expires);
      await sendRecoveryEmail(`${RESET_BASE}?token=${encodeURIComponent(token)}`);
    }
  } catch {
    /* Store or mail failure: the answer stays generic either way. */
  }
  return json({ ok: true }, 200);
}
