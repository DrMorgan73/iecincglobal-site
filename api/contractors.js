/* =====================================================================
   /api/contractors — IEC Partner Portal API.
   ---------------------------------------------------------------------
   Partners work UNDER IEC as IEC contractors on the referral-fee
   program. They are NOT producers and NOT under any channel —
   they are paid a performance-based referral fee ONLY when a
   license a client they added closes. (The routes and tables keep
   the original "contractors" names; partners ARE IEC contractors.)

   Access model (mirrors the demo activation-link model):
     - PUBLIC: fee schedule, partner registration (request access).
       Registration creates an "invited" record; the partner then
       signs the IEC Contractor Referral Agreement + the NDA
       (Combined Master, /cnda.html) — sign-first.
     - ACTIVATION: the IEC office issues a one-time activation
       link (admin invite); following it sets a signed HttpOnly
       cookie scoped to that partner only. Activation is BLOCKED
       until BOTH signatures stand (agreement_status + nda_status
       = signed); a blocked attempt does NOT consume the link.
       The Contractor Referral Agreement itself is accepted
       IN-PORTAL, the way DataSupply's own partner agreement is:
       the link routes an unsigned partner to the agreement page
       (contractors-agreement.html), which presents the full text
       (api/_agreement-content.js — generated verbatim from the
       agreement markdown) and records the partner's acceptance —
       typed full legal name + version id + timestamp — as the
       signature of record. A signature the office recorded (paper
       signed outside the portal) is equally valid and is never
       re-asked. The NDA is still verified by the office through
       the CNDA route.
     - PARTNER (cookie): own record, own clients ONLY (enforced
       server-side on every read and write), add-client with the
       counts-only questionnaire answers, client pipeline view,
       own referral fees. A paused or revoked partner keeps a
       read-only FROZEN view of his clients; every write is
       refused and his clients' pipeline does not move.
     - ADMIN (Desk session): invite, email the invitation from
       info@iecincglobal.com, mark agreement/NDA signed,
       pause/resume/revoke partners, reactivate a revoked partner
       (back to invited, with a fresh activation link), advance the client pipeline (one
       step at a time, from the real events, with the evidence
       recorded), advance the fee pipeline, mark fee paid, record
       IEC-registered companies (duplicate guard), list all.

   CLIENT PIPELINE (referral.pipeline_status, office-advanced):
     added -> questionnaire_sent -> questionnaire_answered
       -> assessment_done -> cnda_sent -> cnda_signed
       -> ready_to_register -> registered
     questionnaire_answered requires the questionnaire submission
     reference that landed in Dana's database; assessment_done
     requires the assessment/valuation reference; cnda_signed
     requires the countersignature verification note (Colby
     standard). No step is ever advanced on a guess.

   COUNTS AND NAMES ONLY. A client record holds the business, its
   owner contact, profile counts (locations, employees, systems,
   years of records) and the counts-only questionnaire answers —
   nothing row-level, no PHI. Identifier-carrying answer content
   is refused and nothing is stored. No practice is ever named to
   anyone outside IEC: a partner sees ONLY his own clients; a
   duplicate registration (another partner's client, or a company
   IEC itself registered) is refused WITHOUT naming the other
   side. Partner-facing responses never name any channel or any
   other party's economics.

   PARTNER CLIENT LINK (2026-11-21, DrMorgan's order — the
   DataSupply seller-link shape, IEC-branded): when a partner is
   activated he is issued a short public code; his client link is
   https://iecincglobal.com/r/<code> (partner-page variant
   /w/p/<code>). He emails it to owners himself, with the ready
   template this API serves on `me`. Opening the link resolves the
   partner (action=partner-link), sets a signed 3-day attribution
   cookie, and routes the owner through registration + the counts-
   only questionnaire (questionnaire-form.html, extended by
   api/questionnaire-submit.js to carry the attribution). A link
   submission from an ACTIVE partner lands as his referral at
   questionnaire_answered, source 'link'; from a paused/revoked
   partner it is held for the Desk (contractor_link_holds) and
   never credited. The duplicate guard applies unchanged.

   Storage: Neon via api/_contractors-store.js. When the store is
   not configured the API says so honestly (503 not_configured).
   ===================================================================== */

import crypto from 'node:crypto';
import {
  contractorsDbConfigured, createContractor, readContractorById,
  readContractorByEmail, listContractors, updateContractor,
  readActivationHash,
  findDuplicateReferral, createReferral, listReferralsByContractor,
  listAllReferrals, readReferral, updateReferral,
  createClientClaim, listClientClaims, deleteClientClaim, businessKey,
  readContractorByClientCode, ensureContractorClientCode,
  readContractorByInviteCode, ensureContractorInviteCode,
  listContractorsByInviter,
  backfillPartnerClientCodes, listLinkHolds, normalizePartnerCode
} from './_contractors-store.js';
import { qrSvg } from './_qr.js';
import { blocksToPdf } from './_data-assets-pdf.js';
import { FEE_SCHEDULE, referralFee, feeExamples, formatUSD } from './_contractors-fees.js';
import {
  QUESTIONNAIRE_SECTIONS, validateQuestionnaireAnswers
} from './_partner-questionnaire.js';
import {
  mintActivationToken, mintSessionToken, verifyToken, hashToken,
  contractorFromRequest, sessionCookieHeader, clearSessionCookieHeader,
  mintAttributionToken, attributionCookieHeader
} from './_contractors-auth.js';
import { AGREEMENT_HTML, agreementVersionId } from './_agreement-content.js';

/* ------------------------------------------------------------------ */
/* Desk session verification — mirrors middleware.js / api/data-assets.js
   exactly. A Desk session is never forged here.                     */
/* ------------------------------------------------------------------ */

function hmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function getCookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function validDeskSession(req) {
  const secret = process.env.DESK_SESSION_SECRET || '';
  if (!secret) return false;
  const raw = getCookie(req, 'desk_session');
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  return timingSafeEqual(hmacHex(secret, `${user}.${exp}`), sig);
}

/* ------------------------------------------------------------------ */
/* Sanitizers — server-side, always.                                  */
/* ------------------------------------------------------------------ */

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
/* Non-negative integer or null (absent). Anything else -> undefined
   (the caller treats undefined as a validation failure). */
const countOrNull = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : undefined;
};
const INDUSTRIES = ['home-health', 'physical-therapy', 'medical-practice', 'pharmacy', 'gas-convenience', 'general-business'];
/* Portal industry -> questionnaire-form segment slug. The form's
   physical-therapy segment is keyed "pt"; the rest match. */
const SEGMENT_BY_INDUSTRY = { 'physical-therapy': 'pt' };
const REFERRAL_ORDER = ['registered', 'agreement_signed', 'license_closed', 'fee_paid'];
const CONTRACTOR_ORDER = ['invited', 'active', 'paused', 'revoked'];
/* The client journey. Partner-facing labels never name any
   channel: the last two steps read "Ready to register" and
   "Registered" in the portal UI. The standalone portal extends
   the journey past registration through the full post-
   registration run to the fee itself (intake review, valuation
   and packaging, presentation, diligence, offer, negotiation,
   license, delivery, acceptance, payment, close, fee earned,
   fee paid) — the same one-step-at-a-time, office-only,
   evidence-from-the-real-event discipline applies. */
const CLIENT_PIPELINE = ['added', 'questionnaire_sent', 'questionnaire_answered', 'assessment_done', 'cnda_sent', 'cnda_signed', 'ready_to_register', 'registered',
  'intake_review', 'valuation_packaging', 'presented', 'buyer_diligence', 'offer_received', 'negotiating_terms',
  'license_sent', 'license_signed', 'data_delivery', 'acceptance_review', 'awaiting_payment', 'deal_closed'];
/* Qualification gate for adding a client (mirrors the program's
   published minimums): most businesses need 20+ local desk
   staff; Legal / Accounting / Healthcare / Energy / Engineering
   qualify at any headcount. The portal's healthcare segments
   are the exempt industries here; gas/convenience and general
   business carry the 20+ rule. The band is recorded on the
   referral; the form hides itself for a non-qualifying answer
   and the API refuses it too. */
const DESK_STAFF_BANDS = ['under-20', '20-34', '35-75', '76-200', 'over-200'];
const QUALIFICATION_EXEMPT_INDUSTRIES = ['home-health', 'physical-therapy', 'medical-practice', 'pharmacy'];
/* Contractor types for the public sign-up — the portal serves IEC
   contractors generally; the data-network partner program is the
   first program inside it. */
const CONTRACTOR_TYPES = ['Data network introductions', 'Clinical services', 'Consulting', 'Business services', 'Other'];
/* Steps that may only be recorded with evidence of the real event:
   the reference that proves it happened. */
const PIPELINE_EVIDENCE = {
  questionnaire_answered: 'the questionnaire submission reference from Dana\u2019s database',
  assessment_done: 'the assessment / valuation reference',
  cnda_signed: 'the countersignature verification note (message opened, signed copy read, signature and date confirmed)',
  presented: 'the presentation reference (what was presented, when, by whom)',
  offer_received: 'the offer reference (buyer, amount, date received)',
  license_signed: 'the signed license reference (countersigned copy verified)'
};

function json(res, obj, status = 200, extraHeaders = {}) {
  res.status(status).setHeader('content-type', 'application/json');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.json(obj);
}

function publicSchedule() {
  return {
    status: FEE_SCHEDULE.status,
    adoptedOn: FEE_SCHEDULE.adoptedOn,
    basis: FEE_SCHEDULE.basis,
    tierThreshold: FEE_SCHEDULE.tierThreshold,
    tierRate: FEE_SCHEDULE.tierRate,
    aboveRate: FEE_SCHEDULE.aboveRate,
    cap: FEE_SCHEDULE.cap,
    paidWithinDays: FEE_SCHEDULE.paidWithinDays,
    openRulings: FEE_SCHEDULE.openRulings,
    examples: feeExamples()
  };
}

function publicContractor(c) {
  return {
    id: c.id, email: c.email, name: c.name, company: c.company,
    status: c.status, ndaStatus: c.ndaStatus,
    agreementStatus: c.agreementStatus || 'pending',
    agreementSignedAt: c.agreementSignedAt || null,
    agreementAcceptedName: c.agreementAcceptedName || '',
    agreementAcceptedVersion: c.agreementAcceptedVersion || '',
    agreementAcceptedVia: c.agreementAcceptedVia || '',
    activatedAt: c.activatedAt,
    source: c.source || 'office-invite',
    contractorType: c.contractorType || '',
    phone: c.phone || '',
    addressStreet: c.addressStreet || '',
    addressCity: c.addressCity || '',
    addressState: c.addressState || '',
    addressZip: c.addressZip || '',
    website: c.website || '',
    heardAbout: c.heardAbout || '',
    notes: c.notes || '',
    payoutMethod: c.payoutMethod || '',
    payoutLast4: c.payoutLast4 || '',
    w9OnFile: !!c.w9OnFile,
    w9UploadedAt: c.w9UploadedAt || null,
    invitedBy: c.invitedBy || '',
    createdAt: c.createdAt || null
  };
}

/* ------------------------------------------------------------------ */
/* Office notification for a PUBLIC sign-up — same Resend pattern as
   api/questionnaire-submit.js (DEMO_ADMIN_RESEND_API_KEY, sender on
   IEC's verified domain). Carries the FULL submitted profile. Never
   throws: a failed notification never fails the sign-up — the
   stored record is the system of record, and the caller reports
   emailed true/false honestly.                                     */
/* ------------------------------------------------------------------ */

const SIGNUP_NOTIFY_TO = 'info@iecincglobal.com';
const SIGNUP_MAIL_FROM = process.env.QUESTIONNAIRE_MAIL_FROM || 'IEC MSO Data Network <notifications@iecincglobal.com>';
const SIGNUP_SIGNATURE_TEXT = [
  'IEC, Inc. · IEC MSO Data Network',
  '857-867-1767',
  'info@iecincglobal.com'
].join('\n');
const SIGNUP_SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
  '<tr><td><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="140" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
  '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
  '<strong>IEC, Inc. · IEC MSO Data Network</strong><br>',
  '<a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
  '<a href="mailto:info@iecincglobal.com" style="color:#1A1A1A;text-decoration:none">info@iecincglobal.com</a>',
  '</td></tr>',
  '</table>'
].join('');

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function signupProfileLines(p) {
  const address = [p.addressStreet, p.addressCity, p.addressState, p.addressZip].filter(Boolean).join(', ');
  return [
    ['Name', p.name], ['Company', p.company], ['Email', p.email],
    ['Contractor type', p.contractorType || '—'],
    ['Phone', p.phone || '—'],
    ['Business address', address || '—'],
    ['Website', p.website || '—'],
    ['How they heard about IEC', p.heardAbout || '—'],
    ['Notes', p.notes || '—'],
    ['Source', 'Public sign-up (contractors.html)'],
    ['Status', 'Invited — no access until the Contractor Referral Agreement and the NDA are both recorded signed']
  ];
}

/* { sent:true, id } | { sent:false, reason } — never throws. */
async function sendSignupNotification(p) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || '';
  if (!key) return { sent: false, reason: 'not_configured' };
  const rows = signupProfileLines(p);
  const text = [
    `New partner sign-up — ${p.company}.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Next step: work it from the Desk Partners admin — send the Contractor Referral Agreement and the NDA for signature; activation opens only once both are recorded signed.',
    '',
    SIGNUP_SIGNATURE_TEXT
  ].join('\n');
  const html = [
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">New partner sign-up — <strong>${escapeHtml(p.company)}</strong>.</p>`,
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:640px">',
    rows.map(([k, v]) => `<tr><td style="padding:6px 10px;border:1px solid #e4e0d6;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5a6b7d">${escapeHtml(k)}</td><td style="padding:6px 10px;border:1px solid #e4e0d6;font-family:Arial,Helvetica,sans-serif;font-size:13px">${escapeHtml(v)}</td></tr>`).join(''),
    '</table>',
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5a6b7d">Next step: work it from the Desk Partners admin — send the Contractor Referral Agreement and the NDA for signature; activation opens only once both are recorded signed.</p>',
    SIGNUP_SIGNATURE_HTML
  ].join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SIGNUP_MAIL_FROM,
        to: [SIGNUP_NOTIFY_TO],
        reply_to: p.email,
        subject: `New partner sign-up — ${p.company}`,
        text, html
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true, id: data.id || null };
  } catch (e) {
    return { sent: false, reason: 'send_failed' };
  }
}

/* ------------------------------------------------------------------ */
/* Partner invitation email — sent by the OFFICE from the Desk, via
   the same Resend integration (sender on IEC's verified domain).
   From is info@iecincglobal.com (DrMorgan's order, 2026-11-12):
   partner invitations are IEC office mail, never personal mail.
   The body mirrors the approved invitation composition: greeting,
   the three steps (agreement in-portal, then the NDA step, then
   the portal opens), the activation button + raw link, the 7-day /
   do-not-forward lines, and the full IEC signature. No fee or
   percentage content — economics live in the signed agreement.
   Never throws: the caller records provenance ONLY on success and
   surfaces the failure reason honestly.                          */
/* ------------------------------------------------------------------ */

const INVITE_FROM_ADDRESS = 'info@iecincglobal.com';
const INVITE_MAIL_FROM = `IEC, Inc. <${INVITE_FROM_ADDRESS}>`;
const INVITE_SUBJECT = 'Your IEC Partner Portal invitation';
const INVITE_SIGNATURE_TEXT = [
  'Mohammed Morgan, MD',
  'Founder & CEO, IEC, Inc.',
  '923 Hyde Park Ave, Boston, MA 02136',
  'info@iecincglobal.com'
].join('\n');
const INVITE_SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;font-family:Arial,Helvetica,sans-serif;max-width:520px">',
  '<tr><td style="padding-bottom:10px"><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="160" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
  '<tr><td style="border-top:3px solid #1a3a5c;padding-top:12px;font-size:13px;line-height:1.55;color:#1A1A1A">',
  '<strong style="font-size:15px;color:#1a3a5c">Mohammed Morgan, MD</strong><br>',
  '<strong style="color:#1a3a5c">Founder &amp; CEO, IEC, Inc.</strong><br>',
  '<span style="color:#555555">923 Hyde Park Ave, Boston, MA 02136</span><br>',
  '<a href="tel:+18578671767" style="color:#1a3a5c;text-decoration:none">857-867-1767</a> &middot; ',
  '<a href="mailto:info@iecincglobal.com" style="color:#1a3a5c;text-decoration:none">info@iecincglobal.com</a> &middot; ',
  '<a href="https://iecincglobal.com" style="color:#1a3a5c;text-decoration:none">iecincglobal.com</a>',
  '</td></tr>',
  '</table>'
].join('');

function buildInvitationEmail(c, activationUrl) {
  const first = String(c.name || '').trim().split(/\s+/)[0] || 'there';
  const text = [
    `Dear ${first},`,
    '',
    'You have been invited to join the IEC Partner Portal — the private portal where IEC\u2019s partners register their clients, track each one through the pipeline, and follow their referrals.',
    '',
    'Your invitation is personal. Here is how it works:',
    '',
    '1. Open your activation link below. It takes you first to the IEC Contractor Referral Agreement — read it in the portal and accept it there by typing your full name. That acceptance is your signature.',
    '2. Next comes the confidentiality step: you will be directed to sign IEC\u2019s confidentiality agreement (NDA).',
    '3. Once both are recorded, your portal opens: your dashboard, your client registrations, and your pipeline.',
    '',
    'Activate your portal:',
    activationUrl,
    '',
    'The link is yours alone — please do not forward it. It stays valid for 7 days.',
    '',
    'Welcome aboard.',
    '',
    'Best regards,',
    INVITE_SIGNATURE_TEXT
  ].join('\n');
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.55">',
    `<p>Dear ${escapeHtml(first)},</p>`,
    '<p>You have been invited to join the <strong>IEC Partner Portal</strong> — the private portal where IEC&rsquo;s partners register their clients, track each one through the pipeline, and follow their referrals.</p>',
    '<p>Your invitation is personal. Here is how it works:</p>',
    '<p><strong>1.</strong> Open your activation link below. It takes you first to the IEC Contractor Referral Agreement — read it in the portal and accept it there by typing your full name. That acceptance is your signature.<br>',
    '<strong>2.</strong> Next comes the confidentiality step: you will be directed to sign IEC&rsquo;s confidentiality agreement (NDA).<br>',
    '<strong>3.</strong> Once both are recorded, your portal opens: your dashboard, your client registrations, and your pipeline.</p>',
    `<p style="margin:22px 0"><a href="${escapeHtml(activationUrl)}" style="background:#1a3a5c;color:#ffffff;padding:12px 22px;text-decoration:none;border-radius:4px;font-weight:bold">Activate your Partner Portal</a></p>`,
    `<p style="font-size:12px;color:#555555">If the button does not open, use this link:<br><a href="${escapeHtml(activationUrl)}">${escapeHtml(activationUrl)}</a></p>`,
    '<p>The link is yours alone — please do not forward it. It stays valid for 7 days.</p>',
    '<p>Welcome aboard.</p>',
    '<p>Best regards,<br>Mohammed Morgan, MD<br>Founder &amp; CEO, IEC, Inc.<br>923 Hyde Park Ave, Boston, MA 02136<br>info@iecincglobal.com</p>',
    INVITE_SIGNATURE_HTML,
    '</div>'
  ].join('\n');
  return {
    from: INVITE_MAIL_FROM,
    to: [c.email],
    subject: INVITE_SUBJECT,
    text, html
  };
}

/* { sent:true, id } | { sent:false, reason } — never throws. */
async function sendInvitationEmail(c, activationUrl) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || '';
  if (!key) return { sent: false, reason: 'not_configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildInvitationEmail(c, activationUrl))
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true, id: data.id || null };
  } catch (e) {
    return { sent: false, reason: 'send_failed' };
  }
}

/* The client shape a partner may see: his own client's profile,
   counts-only answers, pipeline stage and HIS fee — nothing about
   any other party, any channel, or the client's own economics. */
function publicClient(r) {
  return {
    id: r.id, businessName: r.businessName, ownerName: r.ownerName,
    ownerEmail: r.ownerEmail, industry: r.industry, status: r.status,
    locations: r.locations ?? null, employees: r.employees ?? null,
    systems: r.systems ?? null, yearsRecords: r.yearsRecords ?? null,
    pipelineStatus: r.pipelineStatus || 'added',
    pipelineNote: r.pipelineNote ?? null,
    pipelineUpdatedAt: r.pipelineUpdatedAt ?? null,
    /* The dated status timeline (the "process time table"). */
    history: Array.isArray(r.pipelineHistory) ? r.pipelineHistory : [],
    deskStaffBand: r.deskStaffBand || '',
    /* The AMOUNT APPROVED: hidden until IEC approves it. The
       partner sees the figure only once approvedAt stands;
       before that the field is null and amountApproved false —
       the value itself is never in the payload. */
    amountApproved: !!r.approvedAt,
    approvedAmount: r.approvedAt ? (r.approvedAmount ?? null) : null,
    approvedAt: r.approvedAt || null,
    questionnaireAnswers: r.questionnaireAnswers ?? null,
    questionnaireSubmissionId: r.questionnaireSubmissionId ?? null,
    source: r.source || 'partner-entered',
    attributionStatus: r.attributionStatus || 'credited',
    businessCity: r.businessCity || '',
    businessState: r.businessState || '',
    licenseValue: r.licenseValue, ownerGross: r.ownerGross ?? null,
    feeAmount: r.feeAmount,
    feePaidAt: r.feePaidAt, createdAt: r.createdAt
  };
}

/* A partner's fee totals from HIS referrals only: earned = fees on
   closed licenses; paid = fees already paid out. */
function feeTotals(referrals) {
  let earned = 0;
  let paid = 0;
  for (const r of referrals || []) {
    if (r.feeAmount !== null && r.feeAmount !== undefined) {
      earned += Number(r.feeAmount) || 0;
      if (r.status === 'fee_paid') paid += Number(r.feeAmount) || 0;
    }
  }
  return { earned, paid, outstanding: earned - paid };
}

/* Earnings summary for the standalone portal's Earnings page:
   Projected is computed ONLY from amounts IEC has actually
   approved (the referral fee on each approved amount whose
   license has not closed yet) — never from an estimate of what
   a client's data might be worth. Payable = earned, not yet
   paid. Paid = paid out. */
function earningsSummary(referrals) {
  const t = feeTotals(referrals);
  let projected = 0;
  for (const r of referrals || []) {
    if (r.approvedAt && r.approvedAmount !== null && r.approvedAmount !== undefined
      && r.status !== 'license_closed' && r.status !== 'fee_paid') {
      projected += referralFee(r.approvedAmount);
    }
  }
  return { projected, payable: t.outstanding, paid: t.paid, earned: t.earned };
}

/* Append one entry to a referral's dated pipeline history. */
function appendHistory(r, status, note) {
  const hist = Array.isArray(r.pipelineHistory) ? [...r.pipelineHistory] : [];
  hist.push({ status, at: new Date().toISOString(), note: note || null });
  return hist;
}

function questionnaireUrl(industry) {
  const base = String(process.env.CONTRACTOR_PORTAL_BASE_URL || 'https://iecincglobal.com').replace(/\/$/, '');
  const slug = SEGMENT_BY_INDUSTRY[industry] || industry;
  return `${base}/questionnaire-form.html?segment=${encodeURIComponent(slug)}`;
}

function portalBase() {
  return String(process.env.CONTRACTOR_PORTAL_BASE_URL || 'https://iecincglobal.com').replace(/\/$/, '');
}

function activationUrlFor(token) {
  return `${portalBase()}/api/contractors?action=activate&token=${encodeURIComponent(token)}`;
}

/* The partner's public client link, or '' when he holds no code
   (not activated yet). The code is a routing label, safe to show
   the partner and the Desk; it grants no portal access. */
function clientLinkFor(c) {
  const code = normalizePartnerCode(c && c.clientCode);
  return code ? `${portalBase()}/r/${code}` : '';
}

/* The same client link in its STANDALONE portal form — the
   portal host's own /r/<code> landing (partners/register.html).
   The legacy clientLinkFor above is untouched: the legacy pages
   and the in-flight production links keep working until the
   cutover. The standalone app displays this form (re-based onto
   its own origin, so the preview deployment's /partners/r/<code>
   route is what a preview click follows). */
function portalClientLinkFor(c) {
  const code = normalizePartnerCode(c && c.clientCode);
  return code ? `${partnersBase()}/r/${code}` : '';
}

/* The ready-to-send email a partner pastes into his OWN mail to
   introduce a client to IEC. Owner-facing economics ONLY, in the
   conservative form DrMorgan ruled: the program range and the
   owner's 80% share. Never the partner's fee, never any channel
   or other party. IEC-branded throughout. */
function buildClientLinkEmail(c, link) {
  const partnerName = String(c.name || '').trim();
  const partnerCompany = String(c.company || '').trim();
  const fromLine = partnerCompany ? `${partnerName}, ${partnerCompany}` : partnerName;
  const subject = 'Your business data may be worth licensing — a short questionnaire from IEC, Inc.';
  const body = [
    'Hello,',
    '',
    `I am ${fromLine}. I work with IEC, Inc., and I am writing to introduce a program that may be worth your time.`,
    '',
    'IEC helps business owners license their operational data. A license is not a sale: you keep full ownership of your data, the license covers defined uses for a defined term, and nothing moves without an agreement you sign.',
    '',
    'The first step is a short questionnaire — counts only. IEC reviews totals, years of history and the names of the systems you run. No individual records, no customer or patient information, ever.',
    '',
    'Approved licensing programs in this market range from $100,000 to $5,000,000 per term. The owner\u2019s share of any license IEC closes on your data is 80%, paid when the buyer pays.',
    '',
    'You can register your company and complete the questionnaire through my IEC client link:',
    link,
    '',
    'The link is connected to my IEC partner record, so IEC can follow up with you directly and keep me posted on the process.',
    '',
    'Thank you for considering it.',
    '',
    partnerName,
    partnerCompany,
    'IEC Partner'
  ].join('\n');
  return { subject, body, link };
}

/* The standalone portal's public base (its own host — the
   portal is its own product, not a page of the marketing site).
   Join links point there; at staging time the same paths serve
   under the site's /partners/ preview route. */
function partnersBase() {
  return String(process.env.PARTNER_PORTAL_PUBLIC_URL || 'https://partners.iecincglobal.com').replace(/\/$/, '');
}

/* True when this request arrived on the standalone portal host —
   activation then routes into the standalone app (its own front
   door and agreement screen) instead of the legacy site pages.
   The signing gates themselves do not move. */
function isPartnersHost(req) {
  return String(req.headers.host || '').toLowerCase().startsWith('partners.');
}

/* The partner's personal invitation link for OTHER partners
   (flat: direct invitees only), or '' when he holds no code. */
function inviteLinkFor(c) {
  const code = normalizePartnerCode(c && c.inviteCode);
  return code ? `${partnersBase()}/join/${code}` : '';
}

/* The ready invite message a partner sends a prospective
   partner. IEC-branded; carries no economics beyond the
   program's existence — the fee schedule lives in the signed
   agreement, never in an invitation. */
function buildInviteMessage(c, link) {
  const partnerName = String(c.name || '').trim();
  const subject = 'An invitation to the IEC Partner Program';
  const body = [
    'Hello,',
    '',
    `I am ${partnerName}, a partner with IEC, Inc. IEC works with business owners who license their operational data, and its partners are the people who make the introductions.`,
    '',
    'I am inviting you to request your own IEC Partner Portal. Partners register the companies they introduce, follow each one through the process, and are paid a referral fee when a license closes — the terms are in the partner agreement you review and sign before anything opens.',
    '',
    'You can request access through my invitation link:',
    link,
    '',
    'The link is connected to my IEC partner record, so IEC knows the invitation came from me.',
    '',
    'Thank you for considering it.',
    '',
    partnerName,
    'IEC Partner'
  ].join('\n');
  return { subject, body, link };
}

/* The partner's IEC email address, as IEC assigns it at
   activation: first-initial.last-name@iecincglobal.com.
   Display only — IEC provisions the mailbox; the portal never
   creates one. Collisions are resolved by IEC when assigning
   (a middle initial or a number), so this is the expected form,
   labeled as assigned in the portal's Settings. */
function iecEmailFor(c) {
  const name = String(c && c.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  const clean = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const first = clean(parts[0]);
  const last = clean(parts[parts.length - 1]);
  if (!first || !last) return '';
  return `${first[0]}.${last}@iecincglobal.com`;
}

async function readBody(req) {
  const plain = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  if (req.body && typeof req.body === 'object') return plain(req.body);
  if (typeof req.body === 'string') {
    try { return plain(JSON.parse(req.body)); } catch { return {}; }
  }
  const chunks = [];
  try { for await (const chunk of req) chunks.push(chunk); } catch { return {}; }
  try { return plain(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
  catch { return {}; }
}

/* Resolve an activation token to its contractor — the token must
   be signed, unexpired, belong to a live (not revoked) partner,
   and match the hash currently stored for that partner (a
   superseded or already-consumed link resolves to nothing).
   Shared by activation itself and by the in-portal agreement
   step, which rides the same link. Never consumes the token. */
async function resolveActivationToken(token) {
  const contractorId = verifyToken(token);
  if (!contractorId) return null;
  const c = await readContractorById(contractorId);
  if (!c || c.status === 'revoked') return null;
  const stored = await readActivationHash(contractorId);
  if (!stored || stored !== hashToken(token)) return null;
  return c;
}

/* The in-portal acceptance of record for one contractor, or null
   when the agreement was signed on paper and recorded by the
   office (or is not signed at all). */
function agreementAcceptance(c) {
  if ((c.agreementStatus || 'pending') !== 'signed') return null;
  if ((c.agreementAcceptedVia || '') !== 'portal') return null;
  return {
    name: c.agreementAcceptedName || '',
    at: c.agreementSignedAt || null,
    version: c.agreementAcceptedVersion || '',
    via: 'portal'
  };
}

/* Typed legal name vs the name on the partner's record: the
   partner types their full legal name; case and spacing are
   forgiven, the name itself is not. */
const nameMatches = (typed, recorded) =>
  String(typed || '').trim().replace(/\s+/g, ' ').toLowerCase()
  === String(recorded || '').trim().replace(/\s+/g, ' ').toLowerCase();

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const action = String(url.searchParams.get('action') || (req.method === 'POST' ? '' : ''));

  /* ---- public: fee schedule (no auth) ---- */
  if (req.method === 'GET' && action === 'schedule') {
    return json(res, { ok: true, schedule: publicSchedule() });
  }

  if (!contractorsDbConfigured()) {
    return json(res, { ok: false, error: 'not_configured' }, 503);
  }

  /* ---- activation: one-time link -> agreement step -> session ----
     Following the link with either signature outstanding routes
     the partner to the agreement page (the Referral Agreement is
     accepted there, in-portal; the NDA step is shown there too).
     No session is issued and the link is NOT consumed until BOTH
     signatures stand. */
  if (req.method === 'GET' && action === 'activate') {
    const token = String(url.searchParams.get('token') || '');
    const c = await resolveActivationToken(token);
    if (!c) return json(res, { ok: false, error: 'invalid_token' }, 401);
    /* On the standalone portal host, activation routes into the
       standalone app (its own agreement screen and front door);
       on the marketing host it keeps the legacy pages until the
       cutover. The gates are identical either way. */
    const standalone = isPartnersHost(req);
    if (c.ndaStatus !== 'signed' || (c.agreementStatus || 'pending') !== 'signed') {
      res.status(302);
      res.setHeader('Location', standalone
        ? `/?t=${encodeURIComponent(token)}`
        : `/contractors-agreement.html?t=${encodeURIComponent(token)}`);
      return res.end();
    }
    // Both signatures stand: consume the link (its hash was matched
    // by resolveActivationToken) and open the session.
    const session = mintSessionToken(c.id);
    if (!session) return json(res, { ok: false, error: 'not_configured' }, 503);
    await updateContractor(c.id, {
      status: c.status === 'invited' ? 'active' : c.status,
      activationTokenHash: '', activatedAt: new Date().toISOString()
    });
    // Activation issues the partner's client-link code (…/r/<code>)
    // and his partner-invite code — idempotent, collision-checked
    // in the store.
    await ensureContractorClientCode(c.id);
    await ensureContractorInviteCode(c.id);
    res.status(302);
    res.setHeader('Set-Cookie', sessionCookieHeader(session));
    res.setHeader('Location', standalone ? '/' : '/contractors-portal.html');
    return res.end();
  }

  /* ---- the agreement step: full text + acceptance state for the
     partner holding the activation link. The text is the
     generated, verbatim agreement (Articles 1–18 + Exhibit A) —
     served only to the link holder, never publicly: the public
     website carries no fee content, and this instrument is the
     partner's own paper. ---- */
  if (req.method === 'GET' && action === 'agreement') {
    const token = String(url.searchParams.get('token') || '');
    const c = await resolveActivationToken(token);
    if (!c) return json(res, { ok: false, error: 'invalid_token' }, 401);
    return json(res, {
      ok: true,
      version: agreementVersionId(),
      contractor: { name: c.name, company: c.company, email: c.email },
      agreementStatus: c.agreementStatus || 'pending',
      ndaStatus: c.ndaStatus,
      acceptance: agreementAcceptance(c),
      html: AGREEMENT_HTML
    });
  }

  /* ---- accept the agreement in-portal: the typed full legal
     name + the accept action ARE the signature of record (the
     same way IEC accepted DataSupply's partner agreement inside
     their portal). Records {typed name, timestamp, version id}
     and flips agreement_status to signed. A signature already
     standing — in-portal or office-recorded — is never re-asked
     and never overwritten. ---- */
  if (req.method === 'POST' && action === 'accept-agreement') {
    const body = await readBody(req);
    const token = String(body.token || url.searchParams.get('token') || '');
    const c = await resolveActivationToken(token);
    if (!c) return json(res, { ok: false, error: 'invalid_token' }, 401);
    if ((c.agreementStatus || 'pending') === 'signed') {
      return json(res, {
        ok: true, alreadySigned: true, agreementStatus: 'signed',
        ndaStatus: c.ndaStatus, acceptance: agreementAcceptance(c),
        next: c.ndaStatus === 'signed' ? 'activate' : 'nda'
      });
    }
    const typedName = str(body.typedName, 160);
    if (body.accept !== true || !typedName) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    if (!nameMatches(typedName, c.name)) {
      return json(res, {
        ok: false, error: 'name_mismatch',
        message: 'Type your full legal name exactly as it appears on your invitation record.'
      }, 400);
    }
    const version = agreementVersionId();
    const at = new Date().toISOString();
    await updateContractor(c.id, {
      agreementStatus: 'signed', agreementSignedAt: at,
      agreementAcceptedName: typedName,
      agreementAcceptedVersion: version,
      agreementAcceptedVia: 'portal'
    });
    return json(res, {
      ok: true, alreadySigned: false, agreementStatus: 'signed',
      ndaStatus: c.ndaStatus, version,
      acceptance: { name: typedName, at, version, via: 'portal' },
      next: c.ndaStatus === 'signed' ? 'activate' : 'nda'
    });
  }

  /* ---- public: partner registration (thin, legacy shape — kept
     for the original request-access flow; returns no enumeration
     signal for an existing email) ---- */
  if (req.method === 'POST' && action === 'register') {
    const body = await readBody(req);
    const name = str(body.name, 120);
    const email = str(body.email, 120).toLowerCase();
    const company = str(body.company, 160);
    if (!name || !emailOk(email) || !company) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    const existing = await readContractorByEmail(email);
    if (existing) {
      // Same shape as a fresh registration: no enumeration signal.
      return json(res, { ok: true, existing: true, next: '/cnda.html' });
    }
    const id = crypto.randomUUID();
    await createContractor({ id, email, name, company, activationTokenHash: '' });
    return json(res, { ok: true, existing: false, next: '/cnda.html' });
  }

  /* ---- public: partner SIGN-UP (the full-profile request-access
     form on contractors.html). Creates the COMPLETE partner record
     in exactly the state an office invite creates — status
     invited, agreement + NDA pending, source 'public-signup' —
     and notifies the office with the full profile. Sign-up is a
     REQUEST only: the activation gate below does not move, so a
     self-registered partner gets no access and no activation
     until the office records BOTH signatures. The honeypot field
     is company_site_hp — the real website field is a genuine
     profile field and never trips the trap. ---- */
  if (req.method === 'POST' && action === 'signup') {
    const body = await readBody(req);
    /* Honeypot: a real applicant never sees this field. */
    if (str(body.company_site_hp, 200)) {
      return json(res, { ok: false, error: 'rejected' }, 400);
    }
    const name = str(body.name, 120);
    const email = str(body.email, 120).toLowerCase();
    const company = str(body.company, 160);
    const contractorType = str(body.contractorType, 60);
    if (!name || !emailOk(email) || !company || !CONTRACTOR_TYPES.includes(contractorType)) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    const profile = {
      name, company, email, contractorType,
      phone: str(body.phone, 40),
      addressStreet: str(body.street, 200),
      addressCity: str(body.city, 120),
      addressState: str(body.state, 80),
      addressZip: str(body.zip, 20),
      website: str(body.website, 300),
      heardAbout: str(body.heardAbout, 500),
      notes: str(body.notes, 2000)
    };
    const existing = await readContractorByEmail(email);
    if (existing) {
      return json(res, {
        ok: false, error: 'already_registered',
        message: 'This email is already registered with the IEC partner program. If that is you, write to info@iecincglobal.com and we will take it from there.'
      }, 409);
    }
    /* Partner-invite attribution (flat): when the request came
       through a partner's invitation link (/join/<code>), record
       WHO invited this partner. A revoked inviter's code records
       nothing; an unknown code is ignored, never an error — the
       request itself is what matters. */
    let invitedBy = '';
    const inviteCode = normalizePartnerCode(body.inviteCode);
    if (inviteCode) {
      const inviter = await readContractorByInviteCode(inviteCode);
      if (inviter && inviter.status !== 'revoked') invitedBy = inviter.id;
    }
    const id = crypto.randomUUID();
    await createContractor({
      id, email, name, company, activationTokenHash: '',
      source: 'public-signup', invitedBy, ...profile
    });
    const mail = await sendSignupNotification(profile);
    return json(res, { ok: true, emailed: mail.sent, next: '/cnda.html' });
  }

  /* ---- public: resolve a partner invitation link (/join/<code>)
     — the standalone portal's join page names the inviter the
     same way the client landing names an active partner. A
     paused inviter is not named (the code still attributes); a
     revoked inviter's link does not resolve at all. ---- */
  if (req.method === 'GET' && action === 'resolve-invite') {
    const code = normalizePartnerCode(url.searchParams.get('code'));
    if (!code) return json(res, { ok: false, error: 'invalid_link' }, 404);
    const inviter = await readContractorByInviteCode(code);
    if (!inviter || inviter.status === 'revoked') {
      return json(res, { ok: false, error: 'invalid_link' }, 404);
    }
    const active = inviter.status === 'active';
    return json(res, {
      ok: true, code,
      attribution: active ? 'active' : 'held',
      partner: active ? { name: inviter.name, company: inviter.company } : null
    });
  }

  /* ---- public: resolve a partner client link (…/r/<code>) ----
     The landing page calls this to learn whose link it is. For an
     ACTIVE partner the response names him ("You were invited by
     …") and sets the signed 3-day attribution cookie. For a
     paused/revoked partner the link still resolves and the cookie
     is still set (recognition), but NO partner is named and the
     response is flagged held: a submission in that state is held
     for the Desk, never credited (see questionnaire-submit.js).
     An unknown code answers 404 and sets nothing. */
  if (req.method === 'GET' && action === 'partner-link') {
    const code = normalizePartnerCode(url.searchParams.get('code'));
    if (!code) return json(res, { ok: false, error: 'invalid_link' }, 404);
    const c = await readContractorByClientCode(code);
    if (!c) return json(res, { ok: false, error: 'invalid_link' }, 404);
    const active = c.status === 'active';
    const token = mintAttributionToken(code);
    const headers = token ? { 'Set-Cookie': attributionCookieHeader(token) } : {};
    return json(res, {
      ok: true,
      code,
      attribution: active ? 'active' : 'held',
      partner: active ? { name: c.name, company: c.company } : null,
      industries: INDUSTRIES
    }, 200, headers);
  }

  /* ---- contractor session required below ---- */
  const contractorId = contractorFromRequest(req);
  const isAdmin = validDeskSession(req);

  if (req.method === 'POST' && action === 'logout') {
    return json(res, { ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() });
  }

  if (req.method === 'GET' && action === 'me') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c) return json(res, { ok: false, error: 'unauthorized' }, 401);
    // A paused or revoked partner keeps a read-only FROZEN view of
    // his own clients — he can see exactly where each client
    // stands, but nothing can be added or changed (every write
    // below requires status 'active'), and the office does not
    // advance a frozen partner's pipeline.
    const referrals = await listReferralsByContractor(contractorId);
    const clients = (referrals || []).map(publicClient);
    /* The client link is an ACTIVE partner's tool: he sees his
       link + the ready email template only while active. A frozen
       partner's link stops attributing (submissions are held for
       the Desk), so nothing copyable is served here. An active
       partner missing a code (pre-link record) is issued one
       lazily — the same backfill the Desk list runs. */
    let clientLink = '';
    let clientLinkEmail = null;
    let portalClientLink = '';
    let portalClientLinkEmail = null;
    let inviteLink = '';
    let inviteMessage = null;
    if (c.status === 'active') {
      if (!c.clientCode) {
        const issued = await ensureContractorClientCode(c.id);
        if (issued) c.clientCode = issued;
      }
      if (!c.inviteCode) {
        const issuedInvite = await ensureContractorInviteCode(c.id);
        if (issuedInvite) c.inviteCode = issuedInvite;
      }
      clientLink = clientLinkFor(c);
      if (clientLink) clientLinkEmail = buildClientLinkEmail(c, clientLink);
      portalClientLink = portalClientLinkFor(c);
      if (portalClientLink) portalClientLinkEmail = buildClientLinkEmail(c, portalClientLink);
      inviteLink = inviteLinkFor(c);
      if (inviteLink) inviteMessage = buildInviteMessage(c, inviteLink);
    }
    /* The partners THIS partner personally invited (flat list —
       names, companies, statuses, dates; never their fees or
       clients). */
    const invited = (await listContractorsByInviter(contractorId)) || [];
    return json(res, {
      ok: true,
      contractor: publicContractor(c),
      frozen: c.status !== 'active',
      referrals: clients,
      clients,
      feeTotals: feeTotals(referrals),
      earnings: earningsSummary(referrals),
      payout: {
        method: c.payoutMethod || '', last4: c.payoutLast4 || '',
        w9OnFile: !!c.w9OnFile, w9UploadedAt: c.w9UploadedAt || null,
        set: !!(c.payoutMethod && c.payoutLast4)
      },
      iecEmail: iecEmailFor(c),
      pipeline: CLIENT_PIPELINE,
      questionnaireSections: QUESTIONNAIRE_SECTIONS,
      schedule: publicSchedule(),
      clientCode: c.status === 'active' ? (c.clientCode || '') : '',
      clientLink,
      clientLinkEmail,
      portalClientLink,
      portalClientLinkEmail,
      inviteCode: c.status === 'active' ? (c.inviteCode || '') : '',
      inviteLink,
      inviteMessage,
      invitedPartners: invited.map(p => ({
        name: p.name, company: p.company, status: p.status, createdAt: p.createdAt || null
      })),
      fastStart: {
        agreementAccepted: (c.agreementStatus || 'pending') === 'signed' && c.ndaStatus === 'signed',
        payoutsSet: !!(c.payoutMethod && c.payoutLast4)
      }
    });
  }

  /* ---- partner: add a client (sign-first gates, duplicate
     guard, counts-only answers validated before any write) ---- */
  if (req.method === 'POST' && action === 'register-referral') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    if (c.ndaStatus !== 'signed') return json(res, { ok: false, error: 'nda_required' }, 403);
    if ((c.agreementStatus || 'pending') !== 'signed') return json(res, { ok: false, error: 'agreement_required' }, 403);
    const body = await readBody(req);
    const businessName = str(body.businessName, 160);
    const ownerName = str(body.ownerName, 120);
    const ownerEmail = str(body.ownerEmail, 120).toLowerCase();
    const industry = str(body.industry, 40);
    if (!businessName || !ownerName || !emailOk(ownerEmail) || !INDUSTRIES.includes(industry)) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    /* Qualification gate: the desk-staff band is optional for
       legacy callers, but when it is supplied it must be a real
       band, and a non-exempt industry under 20 desk staff does
       not qualify — refused before anything is stored, with the
       rule stated plainly (the portal form hides itself on the
       same answer; this is the server-side half of the gate). */
    const deskStaffBand = str(body.deskStaffBand, 20);
    if (deskStaffBand && !DESK_STAFF_BANDS.includes(deskStaffBand)) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    if (deskStaffBand === 'under-20' && !QUALIFICATION_EXEMPT_INDUSTRIES.includes(industry)) {
      return json(res, {
        ok: false, error: 'not_qualified',
        message: 'This program starts at 20+ local desk staff for this business type. A company below that line does not qualify yet — nothing was saved.'
      }, 400);
    }
    const locations = countOrNull(body.locations);
    const employees = countOrNull(body.employees);
    const yearsRecords = countOrNull(body.yearsRecords);
    const systems = body.systems === undefined || body.systems === null || body.systems === ''
      ? null : str(body.systems, 500);
    if (locations === undefined || employees === undefined || yearsRecords === undefined) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    // Counts-only questionnaire answers: validated (approved keys
    // only, identifier patterns refused) BEFORE anything is stored.
    const checked = validateQuestionnaireAnswers(body.questionnaireAnswers);
    if (!checked.ok) return json(res, { ok: false, error: checked.error }, 400);
    const dup = await findDuplicateReferral(businessName, ownerEmail);
    if (dup) {
      // Refused WITHOUT naming the other partner, the earlier
      // record, or whether IEC itself holds the registration.
      return json(res, { ok: false, error: 'already_registered' }, 409);
    }
    const id = crypto.randomUUID();
    await createReferral({
      id, contractorId, businessName, ownerName, ownerEmail, industry,
      locations, employees, systems, yearsRecords,
      deskStaffBand,
      questionnaireAnswers: checked.answers,
      source: 'partner-entered', attributionStatus: 'credited',
      partnerCode: c.clientCode || ''
    });
    return json(res, { ok: true, referralId: id, clientId: id, status: 'registered', pipelineStatus: 'added' });
  }

  /* ---- partner: one of his own clients (server-side scoping —
     another partner's client id answers 404, never the record) -- */
  if (req.method === 'GET' && action === 'get-client') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const r = await readReferral(str(url.searchParams.get('id'), 64));
    if (!r || r.contractorId !== contractorId) return json(res, { ok: false, error: 'not_found' }, 404);
    return json(res, {
      ok: true, frozen: c.status !== 'active',
      client: publicClient(r), questionnaireUrl: questionnaireUrl(r.industry)
    });
  }

  /* ---- partner: correct his client's profile / answers — only
     while the client is still at 'added'; once the questionnaire
     is out, the office owns the record. ---- */
  if (req.method === 'POST' && action === 'update-client') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    const body = await readBody(req);
    const r = await readReferral(str(body.clientId, 64));
    if (!r || r.contractorId !== contractorId) return json(res, { ok: false, error: 'not_found' }, 404);
    if ((r.pipelineStatus || 'added') !== 'added') {
      return json(res, { ok: false, error: 'client_locked' }, 409);
    }
    const patch = {};
    if (body.locations !== undefined) { const v = countOrNull(body.locations); if (v === undefined) return json(res, { ok: false, error: 'invalid_fields' }, 400); patch.locations = v; }
    if (body.employees !== undefined) { const v = countOrNull(body.employees); if (v === undefined) return json(res, { ok: false, error: 'invalid_fields' }, 400); patch.employees = v; }
    if (body.yearsRecords !== undefined) { const v = countOrNull(body.yearsRecords); if (v === undefined) return json(res, { ok: false, error: 'invalid_fields' }, 400); patch.yearsRecords = v; }
    if (body.systems !== undefined) patch.systems = body.systems === null || body.systems === '' ? null : str(body.systems, 500);
    if (body.questionnaireAnswers !== undefined) {
      const checked = validateQuestionnaireAnswers(body.questionnaireAnswers);
      if (!checked.ok) return json(res, { ok: false, error: checked.error }, 400);
      patch.questionnaireAnswers = checked.answers;
    }
    if (!Object.keys(patch).length) return json(res, { ok: false, error: 'invalid_fields' }, 400);
    await updateReferral(r.id, patch);
    const updated = await readReferral(r.id);
    return json(res, { ok: true, client: publicClient(updated) });
  }

  /* ---- partner: mark the questionnaire sent to his client —
     the one pipeline step the partner himself performs. The
     'questionnaire_answered' step is NOT his to claim: the office
     records it from the submission that lands in Dana's
     database. ---- */
  if (req.method === 'POST' && action === 'send-questionnaire') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    const body = await readBody(req);
    const r = await readReferral(str(body.clientId, 64));
    if (!r || r.contractorId !== contractorId) return json(res, { ok: false, error: 'not_found' }, 404);
    if ((r.pipelineStatus || 'added') !== 'added') {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    await updateReferral(r.id, {
      pipelineStatus: 'questionnaire_sent',
      pipelineUpdatedAt: new Date().toISOString(),
      pipelineHistory: appendHistory(r, 'questionnaire_sent')
    });
    const updated = await readReferral(r.id);
    return json(res, { ok: true, client: publicClient(updated), questionnaireUrl: questionnaireUrl(r.industry) });
  }

  /* ---- partner: update his own profile (Settings). Name and
     email are his identity of record (the agreement acceptance
     matches on the name) and never change here. Active only —
     a frozen portal is read-only. ---- */
  if (req.method === 'POST' && action === 'update-profile') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    const body = await readBody(req);
    const patch = {};
    if (body.phone !== undefined) patch.phone = str(body.phone, 40);
    if (body.company !== undefined) {
      const company = str(body.company, 160);
      if (!company) return json(res, { ok: false, error: 'invalid_fields' }, 400);
      patch.company = company;
    }
    if (body.addressStreet !== undefined) patch.addressStreet = str(body.addressStreet, 200);
    if (body.addressCity !== undefined) patch.addressCity = str(body.addressCity, 120);
    if (body.addressState !== undefined) patch.addressState = str(body.addressState, 80);
    if (body.addressZip !== undefined) patch.addressZip = str(body.addressZip, 20);
    if (body.website !== undefined) patch.website = str(body.website, 300);
    if (!Object.keys(patch).length) return json(res, { ok: false, error: 'invalid_fields' }, 400);
    await updateContractor(c.id, patch);
    const updated = await readContractorById(c.id);
    return json(res, { ok: true, contractor: publicContractor(updated) });
  }

  /* ---- partner: payout settings. Method + the last 4 of the
     account — the full account number is NEVER collected here;
     IEC pays against the details the partner confirms with the
     office. Active only. ---- */
  if (req.method === 'POST' && action === 'update-payout') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    const body = await readBody(req);
    const method = str(body.method, 20);
    if (!['', 'wire', 'check'].includes(method)) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    const last4 = str(body.last4, 8);
    if (method && !/^\d{4}$/.test(last4)) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    await updateContractor(c.id, { payoutMethod: method, payoutLast4: method ? last4 : '' });
    return json(res, {
      ok: true,
      payout: { method, last4: method ? last4 : '', w9OnFile: !!c.w9OnFile, w9UploadedAt: c.w9UploadedAt || null, set: !!method }
    });
  }

  /* ---- partner: W-9 upload. The file itself is emailed to the
     IEC office inbox as an attachment (the office's channel of
     record) — the portal stores only the fact and the date, so
     a tax document never sits in the portal's database or a
     public file store. Active only; PDF only; honest failure:
     if the mail channel is not configured, nothing is recorded. */
  if (req.method === 'POST' && action === 'upload-w9') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    const body = await readBody(req);
    const b64 = String(body.dataBase64 || '');
    if (!b64 || b64.length > 7_000_000) return json(res, { ok: false, error: 'invalid_file' }, 400);
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { return json(res, { ok: false, error: 'invalid_file' }, 400); }
    if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return json(res, { ok: false, error: 'invalid_file' }, 400);
    }
    const key = process.env.DEMO_ADMIN_RESEND_API_KEY || '';
    if (!key) return json(res, { ok: false, error: 'not_configured' }, 503);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: SIGNUP_MAIL_FROM,
          to: [SIGNUP_NOTIFY_TO],
          reply_to: c.email,
          subject: `Partner W-9 received — ${c.company}`,
          text: `${c.name} (${c.company}, ${c.email}) submitted the W-9 attached to this email through the IEC Partner Portal.\n\n${SIGNUP_SIGNATURE_TEXT}`,
          attachments: [{ filename: 'w9.pdf', content: b64 }]
        })
      });
      if (!r.ok) return json(res, { ok: false, error: 'send_failed' }, 502);
    } catch {
      return json(res, { ok: false, error: 'send_failed' }, 502);
    }
    const at = new Date().toISOString();
    await updateContractor(c.id, { w9OnFile: true, w9UploadedAt: at });
    return json(res, { ok: true, w9OnFile: true, w9UploadedAt: at });
  }

  /* ---- partner: his client-link QR code (SVG). Active only —
     a frozen partner's link is not served, as in `me`. ---- */
  if (req.method === 'GET' && action === 'client-link-qr') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status !== 'active') return json(res, { ok: false, error: 'unauthorized' }, 401);
    if (!c.clientCode) {
      const issued = await ensureContractorClientCode(c.id);
      if (issued) c.clientCode = issued;
    }
    /* form=portal encodes the standalone portal form of the link
       (the portal host's own landing); the default keeps the
       legacy form the existing pages display. */
    const link = url.searchParams.get('form') === 'portal'
      ? portalClientLinkFor(c) : clientLinkFor(c);
    if (!link) return json(res, { ok: false, error: 'not_found' }, 404);
    res.status(200);
    res.setHeader('content-type', 'image/svg+xml');
    res.setHeader('cache-control', 'private, max-age=300');
    return res.send(qrSvg(link));
  }

  /* ---- partner: earnings CSV — his referrals and fees only,
     generated from his real records. The approved amount and
     the owner gross appear only where they are his to see (an
     approved amount once IEC has approved it; the gross once
     his fee stands on it). ---- */
  if (req.method === 'GET' && action === 'earnings-csv') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const referrals = (await listReferralsByContractor(contractorId)) || [];
    const cell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['Business', 'Type', 'Stage', 'Registered', 'Amount approved by IEC', 'Owner gross', 'Your fee', 'Fee status', 'Fee paid date'].join(',')];
    for (const r of referrals) {
      lines.push([
        r.businessName, r.industry, r.pipelineStatus || 'added',
        r.createdAt ? String(r.createdAt).slice(0, 10) : '',
        r.approvedAt && r.approvedAmount !== null && r.approvedAmount !== undefined ? r.approvedAmount : '',
        r.feeAmount !== null && r.feeAmount !== undefined ? (r.ownerGross ?? '') : '',
        r.feeAmount ?? '', r.status,
        r.feePaidAt ? String(r.feePaidAt).slice(0, 10) : ''
      ].map(cell).join(','));
    }
    const t = feeTotals(referrals);
    lines.push(['Totals', '', '', '', '', '', t.earned, `earned ${t.earned} · paid ${t.paid} · payable ${t.outstanding}`, ''].map(cell).join(','));
    res.status(200);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="iec-partner-earnings.csv"');
    return res.send(lines.join('\n') + '\n');
  }

  /* ---- partner: plan summary PDF — the adopted schedule and
     his own figures, generated from his real records. ---- */
  if (req.method === 'GET' && action === 'plan-summary') {
    if (!contractorId) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const c = await readContractorById(contractorId);
    if (!c) return json(res, { ok: false, error: 'unauthorized' }, 401);
    const referrals = (await listReferralsByContractor(contractorId)) || [];
    const e = earningsSummary(referrals);
    const blocks = [
      { t: 'p', text: `Partner: **${c.name}** — ${c.company} (${c.email})` },
      { t: 'h2', text: 'Your referral fee — the adopted schedule' },
      { t: 'p', text: 'Your fee is **3% of the first $250,000** of the owner gross on a client\u2019s first closed license, plus **1% of the owner gross above $250,000**, with **no cap**. Paid once per client, on the first closed license only, within 15 days after IEC is paid. The fee is payable by IEC and is never deducted from any amount payable to the owner.' },
      { t: 'table', head: ['Owner gross — first closed license', 'Your referral fee'], rows: feeExamples().map(x => [
        x.ownerGrossTo ? `${formatUSD(x.ownerGrossFrom)} - ${formatUSD(x.ownerGrossTo)}` : `Above ${formatUSD(x.ownerGrossFrom)}`,
        x.feeTo ? `${formatUSD(x.feeFrom)} - ${formatUSD(x.feeTo)}` : `${formatUSD(x.feeFrom)} and up (${formatUSD(x.anchorGross)} -> ${formatUSD(x.anchorFee)})`
      ]) },
      { t: 'h2', text: 'Your earnings' },
      { t: 'table', head: ['Figure', 'Amount'], rows: [
        ['Projected (fees on amounts IEC has approved, licenses not yet closed)', formatUSD(e.projected)],
        ['Payable (earned, not yet paid)', formatUSD(e.payable)],
        ['Paid', formatUSD(e.paid)],
        ['Earned to date', formatUSD(e.earned)]
      ] },
      { t: 'h2', text: 'Your clients' },
      ...(referrals.length ? [{ t: 'table', head: ['Business', 'Stage', 'Your fee'], rows: referrals.map(r => [
        r.businessName, r.pipelineStatus || 'added',
        r.feeAmount !== null && r.feeAmount !== undefined ? formatUSD(r.feeAmount) : 'Not yet set'
      ]) }] : [{ t: 'p', text: 'No clients registered yet.' }]),
      { t: 'p', text: 'IEC, Inc. · International Empire Consultants, Inc. · 923 Hyde Park Ave, Boston, MA 02136 · info@iecincglobal.com' }
    ];
    const pdf = blocksToPdf(blocks, 'IEC Partner Program — Plan Summary');
    res.status(200);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', 'attachment; filename="iec-partner-plan-summary.pdf"');
    return res.send(pdf);
  }

  /* ---- admin: Desk session required below ---- */
  if (!isAdmin) return json(res, { ok: false, error: 'unauthorized' }, 401);

  if (req.method === 'GET' && action === 'admin-list') {
    // Lazy backfill: partners activated before the client link
    // existed receive their codes here (idempotent; 'invited'
    // partners are issued theirs at activation).
    await backfillPartnerClientCodes();
    const contractors = await listContractors();
    const referrals = await listAllReferrals();
    const claims = await listClientClaims();
    /* The holds board is auxiliary: if its read ever fails, the
       Desk still loads and the failure is flagged in the payload
       (linkHoldsError) rather than hidden or fatal. */
    let holds = [];
    let linkHoldsError = false;
    try { holds = (await listLinkHolds()) || []; }
    catch { linkHoldsError = true; }
    const withTotals = (contractors || []).map(c => ({
      ...c,
      clientLink: clientLinkFor(c),
      feeTotals: feeTotals((referrals || []).filter(r => r.contractorId === c.id))
    }));
    return json(res, {
      ok: true, contractors: withTotals,
      referrals: (referrals || []).map(r => ({ ...r, questionnaireUrl: questionnaireUrl(r.industry) })),
      claims: claims || [],
      linkHolds: holds,
      linkHoldsError,
      pipeline: CLIENT_PIPELINE
    });
  }

  if (req.method === 'POST' && action === 'invite') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    if (c.status === 'revoked') return json(res, { ok: false, error: 'revoked' }, 409);
    const token = mintActivationToken(c.id);
    if (!token) return json(res, { ok: false, error: 'not_configured' }, 503);
    await updateContractor(c.id, { activationTokenHash: hashToken(token) });
    return json(res, { ok: true, activationUrl: activationUrlFor(token) });
  }

  /* Email the invitation FROM info@iecincglobal.com (Resend, the
     verified-domain channel) — the office's real send, replacing
     the hand-emailed link. The emailed link is minted for this
     send; its hash and the invitation provenance (sent-at + from)
     are recorded ONLY when the send succeeds, so a failed send
     leaves the record untouched and the error surfaces here. */
  if (req.method === 'POST' && action === 'send-invitation') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    if (c.status === 'revoked') return json(res, { ok: false, error: 'revoked' }, 409);
    const token = mintActivationToken(c.id);
    if (!token) return json(res, { ok: false, error: 'not_configured' }, 503);
    const activationUrl = activationUrlFor(token);
    const mail = await sendInvitationEmail(c, activationUrl);
    if (!mail.sent) {
      return json(res, { ok: false, error: mail.reason },
        mail.reason === 'not_configured' ? 503 : 502);
    }
    const invitationSentAt = new Date().toISOString();
    await updateContractor(c.id, {
      activationTokenHash: hashToken(token),
      invitationSentAt, invitationFrom: INVITE_FROM_ADDRESS
    });
    return json(res, {
      ok: true, emailed: true,
      from: INVITE_FROM_ADDRESS, invitationFrom: INVITE_FROM_ADDRESS,
      invitationSentAt, activationUrl,
      contractorId: c.id, name: c.name, email: c.email
    });
  }

  if (req.method === 'POST' && action === 'set-nda') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    if (body.signed !== true || c.ndaStatus === 'signed') {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    await updateContractor(c.id, { ndaStatus: 'signed' });
    /* The response names the ONE record marked (id + email) so the
       office sees exactly which partner record changed — two
       partners can share a name; only this record's id was updated. */
    return json(res, {
      ok: true, ndaStatus: 'signed',
      contractorId: c.id, name: c.name, email: c.email
    });
  }

  /* Mark the Contractor Referral Agreement signed on paper
     executed OUTSIDE the portal (the office records the status).
     A partner may instead accept in-portal — that path records
     its own evidence (accept-agreement) and never passes here.
     Forward-only. */
  if (req.method === 'POST' && action === 'set-agreement') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    if (body.signed !== true || (c.agreementStatus || 'pending') === 'signed') {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    await updateContractor(c.id, {
      agreementStatus: 'signed', agreementSignedAt: new Date().toISOString()
    });
    /* Same single-record identification as set-nda. */
    return json(res, {
      ok: true, agreementStatus: 'signed',
      contractorId: c.id, name: c.name, email: c.email
    });
  }

  if (req.method === 'POST' && action === 'set-status') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    const target = str(body.status, 20);
    const from = CONTRACTOR_ORDER.indexOf(c.status);
    const to = CONTRACTOR_ORDER.indexOf(target);
    // Forward-only, with ONE backward exception: paused -> active
    // is the office's Resume (the Desk button has always promised
    // it; a pause is a temporary hold, not a termination). Every
    // other backward move is refused; "invited" is never a
    // settable target; a revoked record never leaves 'revoked'
    // here — its only return path is the reactivate action below.
    const isResume = c.status === 'paused' && target === 'active';
    if (to < 0 || target === 'invited' || (to <= from && !isResume)) {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    await updateContractor(c.id, { status: target });
    // A partner returning to active holds a working client link.
    if (target === 'active') await ensureContractorClientCode(c.id);
    return json(res, { ok: true, status: target });
  }

  /* ---- admin: reactivate a REVOKED partner (DrMorgan's order,
     2026-11-21 — the Desk offered no way back from a revocation:
     no reactivate, no link re-issue). This dedicated action is
     the office's single return path, with the same Desk-session
     guard as every admin action: the record goes back to
     'invited' and a FRESH one-time activation link is minted and
     returned (any earlier link stays dead — its hash was consumed
     or is superseded by this one). The partner follows the new
     link and lands active again only when both signatures stand,
     exactly like a first activation; the signing gates do not
     move. ---- */
  if (req.method === 'POST' && action === 'reactivate') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    if (c.status !== 'revoked') {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    const token = mintActivationToken(c.id);
    if (!token) return json(res, { ok: false, error: 'not_configured' }, 503);
    await updateContractor(c.id, { status: 'invited', activationTokenHash: hashToken(token) });
    /* The response names the ONE record reactivated (id + email),
       same discipline as set-nda / set-agreement. */
    return json(res, {
      ok: true, status: 'invited', activationUrl: activationUrlFor(token),
      contractorId: c.id, name: c.name, email: c.email
    });
  }

  if (req.method === 'POST' && action === 'advance-referral') {
    const body = await readBody(req);
    const r = await readReferral(str(body.referralId, 64));
    if (!r) return json(res, { ok: false, error: 'not_found' }, 404);
    const target = str(body.status, 20);
    const from = REFERRAL_ORDER.indexOf(r.status);
    const to = REFERRAL_ORDER.indexOf(target);
    if (to < 0 || to <= from) return json(res, { ok: false, error: 'invalid_transition' }, 409);
    const patch = { status: target };
    if (target === 'license_closed') {
      /* The adopted fee is measured on the OWNER GROSS the owner
         receives on the closed license (recorded here); the license
         value itself is kept as record context when supplied. */
      const og = Number(body.ownerGross);
      if (!Number.isFinite(og) || og <= 0) return json(res, { ok: false, error: 'invalid_fields' }, 400);
      patch.ownerGross = og;
      const lv = Number(body.licenseValue);
      if (Number.isFinite(lv) && lv > 0) patch.licenseValue = lv;
      patch.feeAmount = referralFee(og);
    }
    if (target === 'fee_paid') {
      if (r.status !== 'license_closed') return json(res, { ok: false, error: 'invalid_transition' }, 409);
      patch.feePaidAt = new Date().toISOString();
    }
    /* The fee events belong on the client's dated timeline too:
       the fee is EARNED when the license closes and PAID when
       it pays out — the last two steps of the partner's
       progress checklist read from these entries. */
    if (target === 'license_closed') patch.pipelineHistory = appendHistory(r, 'fee_earned');
    if (target === 'fee_paid') patch.pipelineHistory = appendHistory(r, 'fee_paid');
    await updateReferral(r.id, patch);
    const updated = await readReferral(r.id);
    return json(res, { ok: true, referral: updated });
  }

  /* ---- admin: set (or clear) the AMOUNT APPROVED on one
     referral. Approving records the amount + the timestamp;
     the partner's portal reveals the figure only while
     approved_at stands. Clearing (amount null) re-locks it.
     This is IEC's approval of a real figure from the real
     process — the portal never estimates one. ---- */
  if (req.method === 'POST' && action === 'set-approved-amount') {
    const body = await readBody(req);
    const r = await readReferral(str(body.referralId, 64));
    if (!r) return json(res, { ok: false, error: 'not_found' }, 404);
    if (body.amount === null || body.amount === undefined) {
      await updateReferral(r.id, { approvedAmount: null, approvedAt: null });
      const updated = await readReferral(r.id);
      return json(res, { ok: true, client: publicClient(updated), referral: updated });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    await updateReferral(r.id, { approvedAmount: amount, approvedAt: new Date().toISOString() });
    const updated = await readReferral(r.id);
    return json(res, { ok: true, client: publicClient(updated), referral: updated });
  }

  /* ---- admin: advance the CLIENT pipeline — strictly one step,
     only from the real event, evidence recorded. A frozen
     (paused/revoked) partner's clients do not move. ---- */
  if (req.method === 'POST' && action === 'advance-client') {
    const body = await readBody(req);
    const r = await readReferral(str(body.referralId, 64));
    if (!r) return json(res, { ok: false, error: 'not_found' }, 404);
    const owner = await readContractorById(r.contractorId);
    if (owner && owner.status !== 'active') {
      return json(res, { ok: false, error: 'partner_frozen' }, 409);
    }
    const target = str(body.status, 30);
    const from = CLIENT_PIPELINE.indexOf(r.pipelineStatus || 'added');
    const to = CLIENT_PIPELINE.indexOf(target);
    if (to < 0 || to !== from + 1) {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    const patch = {
      pipelineStatus: target,
      pipelineUpdatedAt: new Date().toISOString()
    };
    if (PIPELINE_EVIDENCE[target]) {
      const evidence = str(body.evidence, 500);
      if (!evidence) {
        return json(res, {
          ok: false, error: 'evidence_required',
          requires: PIPELINE_EVIDENCE[target]
        }, 400);
      }
      patch.pipelineNote = evidence;
      if (target === 'questionnaire_answered') {
        const subId = str(body.submissionId, 120) || evidence;
        patch.questionnaireSubmissionId = subId;
      }
    } else if (body.evidence !== undefined) {
      patch.pipelineNote = str(body.evidence, 500) || null;
    }
    /* Every advance lands on the client's dated timeline — the
       partner's "process time table" is built from exactly
       these entries, so a step that is not recorded here never
       appears there. */
    patch.pipelineHistory = appendHistory(r, target, patch.pipelineNote || null);
    await updateReferral(r.id, patch);
    const updated = await readReferral(r.id);
    return json(res, { ok: true, client: publicClient(updated), referral: updated });
  }

  /* ---- admin: the IEC side of the duplicate guard. Companies
     IEC itself has registered are recorded here; a partner
     registration matching one (business key or owner email) is
     refused without naming this list. ---- */
  if (req.method === 'POST' && action === 'add-claim') {
    const body = await readBody(req);
    const businessName = str(body.businessName, 160);
    const ownerEmail = str(body.ownerEmail, 120).toLowerCase();
    if (!businessName || (ownerEmail && !emailOk(ownerEmail))) {
      return json(res, { ok: false, error: 'invalid_fields' }, 400);
    }
    const claims = await listClientClaims();
    const key = businessKey(businessName);
    if ((claims || []).some(cl => businessKey(cl.businessName) === key)) {
      return json(res, { ok: false, error: 'already_claimed' }, 409);
    }
    const id = crypto.randomUUID();
    await createClientClaim({ id, businessName, ownerEmail, note: str(body.note, 300) });
    return json(res, { ok: true, claimId: id });
  }

  if (req.method === 'POST' && action === 'remove-claim') {
    const body = await readBody(req);
    await deleteClientClaim(str(body.claimId, 64));
    return json(res, { ok: true });
  }

  return json(res, { ok: false, error: 'not_found' }, 404);
}

export const _internals = {
  validDeskSession, publicSchedule, publicContractor, publicClient, feeTotals,
  earningsSummary, appendHistory,
  INDUSTRIES, REFERRAL_ORDER, CONTRACTOR_ORDER, CLIENT_PIPELINE,
  DESK_STAFF_BANDS, QUALIFICATION_EXEMPT_INDUSTRIES,
  PIPELINE_EVIDENCE, SEGMENT_BY_INDUSTRY, questionnaireUrl, formatUSD,
  resolveActivationToken, agreementAcceptance, nameMatches,
  INVITE_FROM_ADDRESS, INVITE_MAIL_FROM, INVITE_SUBJECT,
  buildInvitationEmail, activationUrlFor,
  clientLinkFor, buildClientLinkEmail,
  portalClientLinkFor,
  inviteLinkFor, buildInviteMessage, iecEmailFor, isPartnersHost, partnersBase
};
