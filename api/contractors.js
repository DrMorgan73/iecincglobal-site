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
       until the office has recorded BOTH signatures
       (agreement_status + nda_status = signed); a blocked attempt
       does NOT consume the link.
     - PARTNER (cookie): own record, own clients ONLY (enforced
       server-side on every read and write), add-client with the
       counts-only questionnaire answers, client pipeline view,
       own referral fees. A paused or revoked partner keeps a
       read-only FROZEN view of his clients; every write is
       refused and his clients' pipeline does not move.
     - ADMIN (Desk session): invite, mark agreement/NDA signed,
       pause/revoke partners, advance the client pipeline (one
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
  createClientClaim, listClientClaims, deleteClientClaim, businessKey
} from './_contractors-store.js';
import { FEE_SCHEDULE, referralFee, feeExamples, formatUSD } from './_contractors-fees.js';
import {
  QUESTIONNAIRE_SECTIONS, validateQuestionnaireAnswers
} from './_partner-questionnaire.js';
import {
  mintActivationToken, mintSessionToken, verifyToken, hashToken,
  contractorFromRequest, sessionCookieHeader, clearSessionCookieHeader
} from './_contractors-auth.js';

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
   "Registered" in the portal UI. */
const CLIENT_PIPELINE = ['added', 'questionnaire_sent', 'questionnaire_answered', 'assessment_done', 'cnda_sent', 'cnda_signed', 'ready_to_register', 'registered'];
/* Contractor types for the public sign-up — the portal serves IEC
   contractors generally; the data-network partner program is the
   first program inside it. */
const CONTRACTOR_TYPES = ['Data network introductions', 'Clinical services', 'Consulting', 'Business services', 'Other'];
/* Steps that may only be recorded with evidence of the real event:
   the reference that proves it happened. */
const PIPELINE_EVIDENCE = {
  questionnaire_answered: 'the questionnaire submission reference from Dana\u2019s database',
  assessment_done: 'the assessment / valuation reference',
  cnda_signed: 'the countersignature verification note (message opened, signed copy read, signature and date confirmed)'
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
    baseRate: FEE_SCHEDULE.baseRate,
    bonusThreshold: FEE_SCHEDULE.bonusThreshold,
    bonusRate: FEE_SCHEDULE.bonusRate,
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
    questionnaireAnswers: r.questionnaireAnswers ?? null,
    questionnaireSubmissionId: r.questionnaireSubmissionId ?? null,
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

function questionnaireUrl(industry) {
  const base = String(process.env.CONTRACTOR_PORTAL_BASE_URL || 'https://iecincglobal.com').replace(/\/$/, '');
  const slug = SEGMENT_BY_INDUSTRY[industry] || industry;
  return `${base}/questionnaire-form.html?segment=${encodeURIComponent(slug)}`;
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

  /* ---- activation: one-time link -> session cookie ---- */
  if (req.method === 'GET' && action === 'activate') {
    const token = String(url.searchParams.get('token') || '');
    const contractorId = verifyToken(token);
    if (!contractorId) return json(res, { ok: false, error: 'invalid_token' }, 401);
    const c = await readContractorById(contractorId);
    if (!c || c.status === 'revoked') return json(res, { ok: false, error: 'invalid_token' }, 401);
    // Sign-first gate: activation opens only once the office has
    // recorded BOTH signatures — the Contractor Referral Agreement
    // and the NDA. A blocked attempt does NOT consume the link:
    // the stored hash is checked (and cleared) only after this.
    if (c.ndaStatus !== 'signed' || (c.agreementStatus || 'pending') !== 'signed') {
      return json(res, {
        ok: false, error: 'signing_required',
        agreementStatus: c.agreementStatus || 'pending', ndaStatus: c.ndaStatus
      }, 403);
    }
    // Single-use: the stored hash must match this token, then it is cleared.
    const stored = await readActivationHash(contractorId);
    if (!stored || stored !== hashToken(token)) return json(res, { ok: false, error: 'invalid_token' }, 401);
    const session = mintSessionToken(contractorId);
    if (!session) return json(res, { ok: false, error: 'not_configured' }, 503);
    await updateContractor(contractorId, {
      status: c.status === 'invited' ? 'active' : c.status,
      activationTokenHash: '', activatedAt: new Date().toISOString()
    });
    res.status(302);
    res.setHeader('Set-Cookie', sessionCookieHeader(session));
    res.setHeader('Location', '/contractors-portal.html');
    return res.end();
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
    const id = crypto.randomUUID();
    await createContractor({
      id, email, name, company, activationTokenHash: '',
      source: 'public-signup', ...profile
    });
    const mail = await sendSignupNotification(profile);
    return json(res, { ok: true, emailed: mail.sent, next: '/cnda.html' });
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
    return json(res, {
      ok: true,
      contractor: publicContractor(c),
      frozen: c.status !== 'active',
      referrals: clients,
      clients,
      feeTotals: feeTotals(referrals),
      pipeline: CLIENT_PIPELINE,
      questionnaireSections: QUESTIONNAIRE_SECTIONS,
      schedule: publicSchedule()
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
      questionnaireAnswers: checked.answers
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
      pipelineUpdatedAt: new Date().toISOString()
    });
    const updated = await readReferral(r.id);
    return json(res, { ok: true, client: publicClient(updated), questionnaireUrl: questionnaireUrl(r.industry) });
  }

  /* ---- admin: Desk session required below ---- */
  if (!isAdmin) return json(res, { ok: false, error: 'unauthorized' }, 401);

  if (req.method === 'GET' && action === 'admin-list') {
    const contractors = await listContractors();
    const referrals = await listAllReferrals();
    const claims = await listClientClaims();
    const withTotals = (contractors || []).map(c => ({
      ...c,
      feeTotals: feeTotals((referrals || []).filter(r => r.contractorId === c.id))
    }));
    return json(res, {
      ok: true, contractors: withTotals,
      referrals: (referrals || []).map(r => ({ ...r, questionnaireUrl: questionnaireUrl(r.industry) })),
      claims: claims || [],
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
    const base = String(process.env.CONTRACTOR_PORTAL_BASE_URL || 'https://iecincglobal.com').replace(/\/$/, '');
    return json(res, { ok: true, activationUrl: `${base}/api/contractors?action=activate&token=${encodeURIComponent(token)}` });
  }

  if (req.method === 'POST' && action === 'set-nda') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    if (body.signed !== true || c.ndaStatus === 'signed') {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    await updateContractor(c.id, { ndaStatus: 'signed' });
    return json(res, { ok: true, ndaStatus: 'signed' });
  }

  /* Mark the Contractor Referral Agreement signed (the paper is
     executed outside the portal; the office records the status —
     the portal never invents agreement text). Forward-only. */
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
    return json(res, { ok: true, agreementStatus: 'signed' });
  }

  if (req.method === 'POST' && action === 'set-status') {
    const body = await readBody(req);
    const c = await readContractorById(str(body.contractorId, 64));
    if (!c) return json(res, { ok: false, error: 'not_found' }, 404);
    const target = str(body.status, 20);
    const from = CONTRACTOR_ORDER.indexOf(c.status);
    const to = CONTRACTOR_ORDER.indexOf(target);
    // Forward-only; "invited" is never a settable target; revoked -> invited forbidden.
    if (to < 0 || to <= from || target === 'invited') {
      return json(res, { ok: false, error: 'invalid_transition' }, 409);
    }
    await updateContractor(c.id, { status: target });
    return json(res, { ok: true, status: target });
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
    await updateReferral(r.id, patch);
    const updated = await readReferral(r.id);
    return json(res, { ok: true, referral: updated });
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
  INDUSTRIES, REFERRAL_ORDER, CONTRACTOR_ORDER, CLIENT_PIPELINE,
  PIPELINE_EVIDENCE, SEGMENT_BY_INDUSTRY, questionnaireUrl, formatUSD
};
