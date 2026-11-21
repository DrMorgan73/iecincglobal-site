/* =====================================================================
   IEC Partner Portal — the partner-link client's CNDA step
   (DrMorgan's order, Nov 21, 2026).

   When a business owner comes in through a partner's invitation
   link and completes the profile/questionnaire step — his
   business credentials captured — the portal issues him the IEC
   CNDA BEFORE the client is registered onward: the instrument is
   PRE-FILLED from the captured profile (never an invented value;
   a field the profile does not hold stays for the owner to
   complete) and PRE-SIGNED on the IEC side by Mohammed Morgan,
   MD, Founder & CEO, IEC, Inc. One signing surface serves both
   the in-flow step and the emailed link: partners/cnda.html,
   token-bound to the single record in client_cnda_records.

   The legal text is the central IEC CNDA, extracted mechanically
   from cnda.html into api/_cnda-content.js — never altered here.
   IEC's signature on the executed copy is DrMorgan's handwritten
   signature image of record (api/_assets/iec-signature.png,
   byte-identical to the asset the central CNDA flow stamps onto
   its executed copies), with the typed-name line as the fallback
   — the same convention the central renderer uses.

   Guards, unchanged from the portal's discipline:
   - the partner never sees the document or its contents — his
     timeline shows the cnda_signed stage label and date only;
   - the executed copy is served only to the owner (his token)
     and to the Desk (admin-client-cnda, Desk session);
   - a signing under a frozen partner attaches to the link HOLD,
     flagged for the Desk — never silently credited;
   - a link client cannot be advanced to `presented` or beyond
     until the signed record exists (api/contractors.js).
   ===================================================================== */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  createClientCnda, readClientCndaById, updateClientCnda,
  readReferral, updateReferral
} from './_contractors-store.js';
import { mintToken, verifyToken, hashToken } from './_contractors-auth.js';
import {
  CNDA_TEXTS, CNDA_TITLES, CNDA_IEC_STATE, CNDA_DEFAULT_PURPOSE,
  CNDA_SIGNATORY, buildCndaDocumentHtml
} from './_cnda-content.js';

const TOKEN_TTL_SECONDS = 30 * 24 * 3600; /* 30 days — the owner's own signing link */
const MAIL_FROM = process.env.QUESTIONNAIRE_MAIL_FROM || 'IEC MSO Data Network <notifications@iecincglobal.com>';

/* The standalone portal's public base — same env contract as
   api/contractors.js partnersBase(). */
export function cndaPortalBase() {
  return String(process.env.PARTNER_PORTAL_PUBLIC_URL || 'https://partners.iecincglobal.com').replace(/\/$/, '');
}

export function cndaSigningUrl(token, lang = 'en') {
  return `${cndaPortalBase()}${lang === 'es' ? '/es' : ''}/cnda?token=${encodeURIComponent(token)}`;
}

/* DrMorgan's handwritten signature, the asset of record the
   central CNDA flow stamps onto executed copies (medexec-app
   src/assets/brand/iec-signature.png — copied byte-identically;
   md5 868b1644c84cfaccaa775ae001467eda). Loaded server-side only;
   the file lives under api/_assets and is never served at a
   public path. Null when unavailable — the renderer then falls
   back to the typed signature line, exactly as the central
   renderer does. */
export function loadIecSignatureDataUri() {
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), 'api/_assets/iec-signature.png'));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '');

/* ---------------- the issuance email ----------------
   IEC-branded, from the portal's mail channel, carrying the
   FULL personal signature block per the standing email standard
   (logo + Mohammed Morgan, MD typed block). EN + ES. */
const PERSONAL_SIGNATURE_TEXT = [
  'Mohammed Morgan, MD',
  'Founder & CEO, IEC, Inc. · Head of IEC MSO',
  'iecincglobal.com | 857-867-1767',
  'info@iecincglobal.com'
].join('\n');

const PERSONAL_SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
  '<tr><td><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="140" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
  '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
  '<strong>Mohammed Morgan, MD</strong><br>',
  'Founder &amp; CEO, IEC, Inc. · Head of IEC MSO<br>',
  '<a href="https://iecincglobal.com" style="color:#1A1A1A;text-decoration:none">iecincglobal.com</a> | <a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
  '<a href="mailto:info@iecincglobal.com" style="color:#1A1A1A;text-decoration:none">info@iecincglobal.com</a>',
  '</td></tr>',
  '</table>'
].join('');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildCndaEmail({ lang = 'en', businessName, signerName, iecDate, url }) {
  if (lang === 'es') {
    const subject = `Su CNDA de IEC — firmado por IEC y listo para su contrafirma — ${businessName}`;
    const text = [
      `Estimado/a ${signerName}:`,
      '',
      'Su registro comercial con IEC, Inc. está registrado y su cuestionario ya llegó. El siguiente paso va antes que cualquier otro: el Acuerdo General de Confidencialidad y No Divulgación de IEC (el CNDA).',
      '',
      `IEC ya firmó su parte: Mohammed Morgan, MD, Fundador y CEO, IEC, Inc., el ${iecDate}. El acuerdo viene precompletado con la información de su empresa tomada de su registro:`,
      '',
      `  Empresa: ${businessName}`,
      `  Firmante: ${signerName}`,
      '',
      'Algunos campos solo usted puede completarlos (el tipo de entidad y el estado, la dirección principal y las fechas); quedan abiertos en la página de firma.',
      '',
      'Revise el acuerdo y fírmelo aquí:',
      url,
      '',
      'El enlace es personal y válido por 30 días. Al contrafirmar, el acuerdo ejecutado queda registrado en el expediente de su empresa y su registro continúa.',
      '',
      PERSONAL_SIGNATURE_TEXT
    ].join('\n');
    const html = [
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Estimado/a ${esc(signerName)}:</p>`,
      '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Su registro comercial con IEC, Inc. está registrado y su cuestionario ya llegó. El siguiente paso va antes que cualquier otro: el Acuerdo General de Confidencialidad y No Divulgación de IEC (el CNDA).</p>',
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">IEC ya firmó su parte: <strong>Mohammed Morgan, MD</strong>, Fundador y CEO, IEC, Inc., el ${esc(iecDate)}. El acuerdo viene precompletado con la información de su empresa tomada de su registro:</p>`,
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Empresa: <strong>${esc(businessName)}</strong><br>Firmante: ${esc(signerName)}</p>`,
      '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Algunos campos solo usted puede completarlos (el tipo de entidad y el estado, la dirección principal y las fechas); quedan abiertos en la página de firma.</p>',
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><a href="${esc(url)}" style="color:#0E2A47;font-weight:bold">Revise el acuerdo y fírmelo aquí</a><br><span style="font-size:13px;color:#5a6b7d">${esc(url)}</span></p>`,
      '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">El enlace es personal y válido por 30 días. Al contrafirmar, el acuerdo ejecutado queda registrado en el expediente de su empresa y su registro continúa.</p>',
      PERSONAL_SIGNATURE_HTML
    ].join('\n');
    return { subject, text, html };
  }
  const subject = `Your IEC CNDA — signed by IEC and ready for your countersignature — ${businessName}`;
  const text = [
    `Dear ${signerName},`,
    '',
    'Your business registration with IEC, Inc. is recorded, and your questionnaire is in. The next step comes before anything else: the IEC General Confidentiality and Non-Disclosure Agreement (the CNDA).',
    '',
    `IEC has already signed its side — Mohammed Morgan, MD, Founder & CEO, IEC, Inc., on ${iecDate}. The agreement is pre-filled with your business's information from your registration:`,
    '',
    `  Business: ${businessName}`,
    `  Signer: ${signerName}`,
    '',
    'A few fields only you can complete (entity type and state, principal address, and dates) are left open on the signing page.',
    '',
    'Review the agreement and countersign here:',
    url,
    '',
    'The link is personal to you and stays valid for 30 days. Once you countersign, the executed agreement is recorded on your company record and your registration proceeds.',
    '',
    PERSONAL_SIGNATURE_TEXT
  ].join('\n');
  const html = [
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Dear ${esc(signerName)},</p>`,
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Your business registration with IEC, Inc. is recorded, and your questionnaire is in. The next step comes before anything else: the IEC General Confidentiality and Non-Disclosure Agreement (the CNDA).</p>',
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">IEC has already signed its side — <strong>Mohammed Morgan, MD</strong>, Founder &amp; CEO, IEC, Inc., on ${esc(iecDate)}. The agreement is pre-filled with your business&rsquo;s information from your registration:</p>`,
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Business: <strong>${esc(businessName)}</strong><br>Signer: ${esc(signerName)}</p>`,
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">A few fields only you can complete (entity type and state, principal address, and dates) are left open on the signing page.</p>',
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><a href="${esc(url)}" style="color:#0E2A47;font-weight:bold">Review the agreement and countersign here</a><br><span style="font-size:13px;color:#5a6b7d">${esc(url)}</span></p>`,
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">The link is personal to you and stays valid for 30 days. Once you countersign, the executed agreement is recorded on your company record and your registration proceeds.</p>',
    PERSONAL_SIGNATURE_HTML
  ].join('\n');
  return { subject, text, html };
}

/* { sent } — never throws. */
async function sendViaResend({ to, cc, subject, text, html, replyTo }) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || '';
  if (!key) return { sent: false, reason: 'not_configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: MAIL_FROM, to: [to], ...(cc ? { cc: [cc] } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}), subject, text, html
      })
    });
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: 'send_failed' };
  }
}

async function sendCndaEmail(record, token, lang) {
  const mail = buildCndaEmail({
    lang, businessName: record.businessName, signerName: record.signerName,
    iecDate: dateOnly(record.iecSignedAt), url: cndaSigningUrl(token, lang)
  });
  return sendViaResend({ to: record.signerEmail, subject: mail.subject, text: mail.text, html: mail.html, replyTo: 'info@iecincglobal.com' });
}

/* ---------------- issuance ----------------
   Creates the record (IEC side signed at issuance — the IEC
   signing date is the issuance date, the same date the central
   flow stamps on its executed copies), mints the owner's
   signing token (hash stored; a re-issue supersedes it), and
   emails the owner. Returns { id, token, url, emailed } or
   null when the portal is not configured to mint tokens. */
export async function issueClientCnda({ referralId = null, holdId = null, contractorId, businessName, ownerName, ownerEmail, businessCity = '', businessState = '', industry = '', lang = 'en' }) {
  const id = crypto.randomUUID();
  const token = mintToken(id, TOKEN_TTL_SECONDS);
  if (!token) return null;
  const now = new Date().toISOString();
  const record = {
    id, referralId, holdId, contractorId,
    tokenHash: hashToken(token), status: 'issued',
    businessName, signerName: ownerName, signerEmail: ownerEmail,
    businessCity, businessState, industry,
    iecSignedName: CNDA_SIGNATORY.name, iecSignedTitle: CNDA_SIGNATORY.title,
    iecSignedAt: now, emailed: false, issuedAt: now
  };
  await createClientCnda(record);
  const mail = await sendCndaEmail(record, token, lang);
  if (mail.sent) await updateClientCnda(id, { emailed: true });
  return { id, token, url: cndaSigningUrl(token, lang), emailed: mail.sent };
}

/* Desk re-issue: a fresh token supersedes the old one; the IEC
   signing date restates to the re-issue date (the copy is issued
   that day). Refused for a signed record by the caller. Tokens
   are deterministic per (id, expiry-second), so a re-issue
   inside the same second as the previous mint would reproduce
   the old token — wait out the second boundary so the fresh
   token genuinely supersedes. */
export async function reissueClientCnda(record, { lang = 'en' } = {}) {
  let token = mintToken(record.id, TOKEN_TTL_SECONDS);
  if (!token) return null;
  if (record.tokenHash && hashToken(token) === record.tokenHash) {
    await new Promise((r) => setTimeout(r, 1005 - (Date.now() % 1000)));
    token = mintToken(record.id, TOKEN_TTL_SECONDS);
    if (!token || hashToken(token) === record.tokenHash) return null;
  }
  const now = new Date().toISOString();
  await updateClientCnda(record.id, { tokenHash: hashToken(token), iecSignedAt: now });
  const fresh = { ...record, iecSignedAt: now };
  const mail = await sendCndaEmail(fresh, token, lang);
  if (mail.sent) await updateClientCnda(record.id, { emailed: true });
  return { id: record.id, token, url: cndaSigningUrl(token, lang), emailed: mail.sent };
}

/* Resolve an owner's signing token to its record — signed,
   unexpired, and matching the stored hash (a superseded link
   resolves to nothing, the activation discipline). */
export async function resolveClientCndaToken(token) {
  const id = verifyToken(String(token || ''));
  if (!id) return null;
  const rec = await readClientCndaById(id);
  if (!rec) return null;
  if (!rec.tokenHash || rec.tokenHash !== hashToken(String(token))) return null;
  return rec;
}

/* What the signing page may see: the pre-filled values (exactly
   what the profile holds), the IEC block, the instrument's own
   defaults, and the legal texts themselves — plus, once signed,
   the owner's own executed copy. No other record data. */
export function publicCndaView(rec) {
  return {
    status: rec.status,
    businessName: rec.businessName,
    prefill: {
      party: rec.businessName,
      name: rec.signerName,
      email: rec.signerEmail,
      city: rec.businessCity || '',
      state: rec.businessState || ''
    },
    defaults: { iecState: CNDA_IEC_STATE, purpose: CNDA_DEFAULT_PURPOSE },
    iec: {
      name: rec.iecSignedName || CNDA_SIGNATORY.name,
      title: rec.iecSignedTitle || CNDA_SIGNATORY.title,
      signedAt: rec.iecSignedAt || null,
      date: dateOnly(rec.iecSignedAt)
    },
    texts: CNDA_TEXTS,
    titles: CNDA_TITLES,
    signed: rec.status === 'signed' ? {
      name: rec.signedName, title: rec.signedTitle || '',
      date: rec.signedDate, effectiveDate: rec.effectiveDate,
      signedAt: rec.signedAt
    } : null,
    documentHtml: rec.status === 'signed' ? rec.documentHtml : null
  };
}

/* ---------------- countersignature ---------------- */
const isDateStr = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(String(v)));
const normName = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();

/* Validate the owner's countersignature against the issued
   record, render the executed copy server-side, persist it,
   and land the dated cnda_signed entry on the client's timeline
   (referral records only — a hold's signing waits with the hold
   for the Desk's ruling, and the entry is added when the hold
   is credited; see resolve-hold in api/contractors.js).
   Returns { ok:true, signedAt, documentHtml } | { error }. */
export async function signClientCnda(rec, fields) {
  if (rec.status === 'signed') return { error: 'already_signed' };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const values = {
    effectiveDate: str(fields.effectiveDate, 10),
    iecState: CNDA_IEC_STATE, /* IEC's own fact — the instrument states it; not owner-editable */
    party: str(fields.party, 200),
    entityTypeState: str(fields.entityTypeState, 200),
    address: str(fields.address, 300),
    purpose: str(fields.purpose, 1000) || CNDA_DEFAULT_PURPOSE,
    name: str(fields.name, 200),
    title: str(fields.title, 120),
    date: str(fields.date, 10),
    signature: str(fields.signature, 200),
    email: str(fields.email, 200).toLowerCase()
  };
  if (fields.agree !== true) return { error: 'agreement_required' };
  if (!values.party || !values.entityTypeState || !values.address || !values.name || !values.signature) {
    return { error: 'invalid_fields' };
  }
  if (!isDateStr(values.effectiveDate) || !isDateStr(values.date)) return { error: 'invalid_fields' };
  if (values.email !== String(rec.signerEmail || '').toLowerCase()) return { error: 'signer_mismatch' };
  if (normName(values.signature) !== normName(values.name)) return { error: 'signature_mismatch' };

  const signedAt = new Date().toISOString();
  const documentHtml = buildCndaDocumentHtml(values, {
    iecSignatureImg: loadIecSignatureDataUri() || '',
    iecDate: dateOnly(rec.iecSignedAt)
  });
  await updateClientCnda(rec.id, {
    status: 'signed',
    signedName: values.name, signedTitle: values.title, signedDate: values.date,
    effectiveDate: values.effectiveDate, entityTypeState: values.entityTypeState,
    address: values.address, purpose: values.purpose, iecState: values.iecState,
    typedSignature: values.signature, signedValues: values,
    documentHtml, signedAt
  });

  /* The dated timeline entry — label and date only ever reach
     the partner. Appended here (not left to the office advance)
     so the real event is what the timeline records; the Desk
     advance to cnda_signed then needs no typed evidence and
     never duplicates the entry. */
  if (rec.referralId) {
    try {
      const r = await readReferral(rec.referralId);
      if (r && !(r.pipelineHistory || []).some((h) => h.status === 'cnda_signed')) {
        await updateReferral(rec.referralId, {
          pipelineHistory: [...(r.pipelineHistory || []), { status: 'cnda_signed', at: signedAt, note: null }]
        });
      }
    } catch (e) {
      console.error(`[client-cnda] timeline append FAILED for ${rec.id}: ${e && e.message}`);
    }
  }

  /* The executed-copy notice: to the owner, cc IEC — the same
     pair the central flow notifies. The copy itself lives in
     the record (owner's link + Desk), never as an attachment
     floating outside it. Best-effort, like every portal mail. */
  const mail = {
    subject: `Your IEC CNDA is executed — ${rec.businessName}`,
    text: [
      `Dear ${values.name},`,
      '',
      `Your countersignature is recorded. The IEC General CNDA and Procuring Party Agreement between IEC, Inc. and ${values.party} is executed as of ${values.effectiveDate} and stands on your company record.`,
      '',
      'IEC will follow up with the next steps directly.',
      '',
      PERSONAL_SIGNATURE_TEXT
    ].join('\n'),
    html: [
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Dear ${esc(values.name)},</p>`,
      `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">Your countersignature is recorded. The IEC General CNDA and Procuring Party Agreement between IEC, Inc. and <strong>${esc(values.party)}</strong> is executed as of ${esc(values.effectiveDate)} and stands on your company record.</p>`,
      '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">IEC will follow up with the next steps directly.</p>',
      PERSONAL_SIGNATURE_HTML
    ].join('\n')
  };
  await sendViaResend({ to: rec.signerEmail, cc: 'info@iecincglobal.com', subject: mail.subject, text: mail.text, html: mail.html });

  return { ok: true, signedAt, documentHtml };
}

export const _internals = { buildCndaEmail, cndaSigningUrl, dateOnly, PERSONAL_SIGNATURE_TEXT };
