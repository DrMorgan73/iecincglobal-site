/* =====================================================================
   IEC Contractor Portal — STORAGE (Neon Postgres, same pattern as
   api/_data-assets-store.js: HTTPS SQL endpoint, no driver).
   ---------------------------------------------------------------------
   Tables (created with CREATE TABLE IF NOT EXISTS on first use —
   an idempotent bootstrap, so no manual migration is needed;
   columns added later are applied with ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS so an existing database upgrades in
   place):

     contractors          one row per contractor/partner (id PK,
                          email UNIQUE). Carries the FULL partner
                          profile: source ('office-invite' default,
                          'public-signup' for self-registered), phone,
                          business address, website, how they heard
                          about IEC, and free notes — the complete
                          record the office works from.
                          client_code is the partner's public
                          client-link code (…/r/<code>): issued when
                          the partner is activated (both signatures
                          recorded), 8 characters from an unambiguous
                          alphabet, collision-checked at issue. It is
                          a public routing code, not a credential —
                          the partner's access still rides the
                          activation link + session cookie alone.
     contractor_link_holds registrations that arrived through a
                          partner's client link while that partner
                          was NOT active (paused/revoked): stored
                          for the Desk, flagged, and NEVER credited
                          to the partner as a referral.
                          agreement_accepted_* records an IN-PORTAL
                          acceptance of the Referral Agreement (the
                          partner read the full text in the portal
                          and accepted it — typed legal name,
                          timestamp, instrument version). An
                          office-recorded signature leaves
                          agreement_accepted_via empty; 'portal' is
                          the in-portal evidence of record.
     contractor_tax_forms one row per contractor (contractor_id
                          PK): the partner's tax form (W-9 or
                          W-8BEN) ON FILE — the uploaded file itself
                          (base64), its type, file name, content
                          type, size and upload time. Server-side
                          store ONLY: the content is never written
                          to any static/public path and is served
                          back solely through the Desk-authenticated
                          admin action in api/contractors.js.
                          contractors.w9_on_file / w9_uploaded_at /
                          tax_form_type carry the status the portal
                          displays (kept under their original column
                          names; the form on file may be a W-8BEN).
     contractor_referrals one row per registered client (id PK)
     client_claims        companies IEC itself has registered —
                          the office-maintained half of the
                          duplicate guard (see findDuplicateReferral)

   STANDALONE PORTAL EXTENSION (2026-11-21): contractors carry
   invited_by (the partner whose invite link brought this partner
   in — IEC's network is FLAT: a partner sees only his own
   invites, never levels, never another partner's financials) and
   faststart_webinar_at (the Fast Start checklist's webinar step).
   Referrals carry approved_amount + approved_unlocked (the
   AMOUNT APPROVED: recorded by the office, shown to the partner
   ONLY once the office unlocks it) and pipeline_history — the
   dated per-company status timeline (the "process time table"):
   an append-only JSON array of {status, at, note}, seeded at
   creation and extended on every office pipeline advance.

   COUNTS AND NAMES ONLY. A referral records the referred business
   and its owner contact — the identifiers IEC needs to register an
   introduction and to pay a fee. No patient or customer records,
   no counts documents, no PHI: nothing row-level is ever stored
   here. The fee schedule's money fields are integers (dollars).

   Status machines (forward-only; a step never moves backwards):
     contractor.status: invited -> active -> paused -> revoked
       (forward-only via set-status, with the single backward
       exception paused -> active — the office's Resume.
       "invited" is never a settable target there. A REVOKED
       record returns only through the dedicated admin
       reactivate action — status back to invited plus a fresh
       activation token — added on DrMorgan's order, 2026-11-21;
       set-status itself never moves a record out of revoked.)
     contractor.nda_status: pending -> signed
     contractor.agreement_status: pending -> signed
       (the Contractor Referral Agreement; activation is blocked
       until BOTH nda_status and agreement_status are signed.)
     referral.status (fee pipeline): registered -> agreement_signed
       -> license_closed -> fee_paid
     referral.pipeline_status (client journey): added
       -> questionnaire_sent -> questionnaire_answered
       -> assessment_done -> cnda_sent -> cnda_signed
       -> ready_to_register -> registered
       (advanced by the office only, one step at a time, from the
       real events — see api/contractors.js advance-client.)

   The database URL is read from CONTRACTORS_DATABASE_URL when set,
   falling back to DATA_ASSETS_DATABASE_URL, then to
   QUESTIONNAIRE_DATABASE_URL (the same Neon database the
   questionnaire pipeline already uses on this project). When no
   database is configured the store reports null and the API says
   so honestly (503 not_configured) — a save is never faked.
   ===================================================================== */

import crypto from 'node:crypto';

const globalKey = '__iecContractorsStore';
const state = globalThis[globalKey] || (globalThis[globalKey] = { urlOverride: undefined, tablesReady: false });

function databaseUrl() {
  if (state.urlOverride !== undefined) return state.urlOverride;
  return process.env.CONTRACTORS_DATABASE_URL
    || process.env.DATA_ASSETS_DATABASE_URL
    || process.env.QUESTIONNAIRE_DATABASE_URL || '';
}

export function contractorsDbConfigured() {
  return !!databaseUrl();
}

export function __setDbUrlOverride(v) { state.urlOverride = v; state.tablesReady = false; }

function parseDatabaseUrl(raw) {
  const url = new URL(raw);
  const host = url.hostname;
  const auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return { host, auth, database: url.pathname.replace(/^\/|^$/, '') || 'neondb' };
}

async function neonQuery(text, params) {
  const { host, auth, database } = parseDatabaseUrl(databaseUrl());
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': `postgres://${auth}@${host}/${database}?sslmode=require`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: text, params: params || [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`neon ${res.status}: ${data && data.message ? String(data.message).slice(0, 200) : 'query failed'}`);
  }
  if (data && data.error) throw new Error(String(data.error).slice(0, 200));
  return (data && data.rows) || [];
}

async function ensureTables() {
  if (state.tablesReady) return;
  await neonQuery(`CREATE TABLE IF NOT EXISTS contractors (
    id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
    company text NOT NULL, status text NOT NULL DEFAULT 'invited',
    contractor_type text NOT NULL DEFAULT '',
    nda_status text NOT NULL DEFAULT 'pending',
    agreement_status text NOT NULL DEFAULT 'pending',
    agreement_signed_at timestamptz,
    agreement_accepted_name text NOT NULL DEFAULT '',
    agreement_accepted_version text NOT NULL DEFAULT '',
    agreement_accepted_via text NOT NULL DEFAULT '',
    activation_token_hash text NOT NULL DEFAULT '',
    client_code text UNIQUE,
    invite_code text UNIQUE,
    invited_by text NOT NULL DEFAULT '',
    payout_method text NOT NULL DEFAULT '',
    payout_last4 text NOT NULL DEFAULT '',
    w9_on_file boolean NOT NULL DEFAULT false,
    w9_uploaded_at timestamptz,
    tax_form_type text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'office-invite',
    phone text NOT NULL DEFAULT '',
    address_street text NOT NULL DEFAULT '',
    address_city text NOT NULL DEFAULT '',
    address_state text NOT NULL DEFAULT '',
    address_zip text NOT NULL DEFAULT '',
    website text NOT NULL DEFAULT '',
    heard_about text NOT NULL DEFAULT '',
    notes text NOT NULL DEFAULT '',
    activated_at timestamptz,
    invitation_sent_at timestamptz,
    invitation_from text NOT NULL DEFAULT '',
    faststart_webinar_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS contractor_referrals (
    id text PRIMARY KEY, contractor_id text NOT NULL, business_name text NOT NULL,
    business_key text NOT NULL, owner_name text NOT NULL, owner_email text NOT NULL,
    industry text NOT NULL, status text NOT NULL DEFAULT 'registered',
    license_value numeric, owner_gross numeric, fee_amount integer, fee_paid_at timestamptz,
    locations integer, employees integer, systems text, years_records integer,
    pipeline_status text NOT NULL DEFAULT 'added',
    pipeline_history jsonb,
    approved_amount numeric, approved_at timestamptz,
    desk_staff_band text NOT NULL DEFAULT '',
    questionnaire_answers jsonb, questionnaire_submission_id text,
    pipeline_note text, pipeline_updated_at timestamptz,
    source text NOT NULL DEFAULT 'partner-entered',
    attribution_status text NOT NULL DEFAULT 'credited',
    partner_code text NOT NULL DEFAULT '',
    business_city text NOT NULL DEFAULT '',
    business_state text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS contractor_link_holds (
    id text PRIMARY KEY, contractor_id text NOT NULL,
    client_code text NOT NULL DEFAULT '',
    business_name text NOT NULL, business_key text NOT NULL,
    owner_name text NOT NULL, owner_email text NOT NULL,
    industry text NOT NULL DEFAULT '',
    business_city text NOT NULL DEFAULT '',
    business_state text NOT NULL DEFAULT '',
    questionnaire_answers jsonb, questionnaire_submission_id text,
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS client_claims (
    id text PRIMARY KEY, business_name text NOT NULL, business_key text NOT NULL,
    owner_email text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS contractor_tax_forms (
    contractor_id text PRIMARY KEY,
    form_type text NOT NULL DEFAULT 'W-9',
    file_name text NOT NULL DEFAULT '',
    content_type text NOT NULL DEFAULT 'application/pdf',
    size_bytes integer NOT NULL DEFAULT 0,
    content_base64 text NOT NULL DEFAULT '',
    uploaded_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS client_cnda_records (
    id text PRIMARY KEY, referral_id text, hold_id text,
    contractor_id text NOT NULL,
    token_hash text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'issued',
    business_name text NOT NULL DEFAULT '',
    signer_name text NOT NULL DEFAULT '',
    signer_email text NOT NULL DEFAULT '',
    business_city text NOT NULL DEFAULT '',
    business_state text NOT NULL DEFAULT '',
    industry text NOT NULL DEFAULT '',
    iec_signed_name text NOT NULL DEFAULT '',
    iec_signed_title text NOT NULL DEFAULT '',
    iec_signed_at timestamptz,
    signed_name text NOT NULL DEFAULT '',
    signed_title text NOT NULL DEFAULT '',
    signed_date text NOT NULL DEFAULT '',
    effective_date text NOT NULL DEFAULT '',
    entity_type_state text NOT NULL DEFAULT '',
    address text NOT NULL DEFAULT '',
    purpose text NOT NULL DEFAULT '',
    iec_state text NOT NULL DEFAULT '',
    typed_signature text NOT NULL DEFAULT '',
    signed_values jsonb,
    document_html text NOT NULL DEFAULT '',
    emailed boolean NOT NULL DEFAULT false,
    issued_at timestamptz NOT NULL DEFAULT now(),
    signed_at timestamptz)`);
  /* Upgrades for databases created before the Partner Portal
     extension: every added column, IF NOT EXISTS. */
  for (const stmt of [
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_status text NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_signed_at timestamptz`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_accepted_name text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_accepted_version text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_accepted_via text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'office-invite'`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS contractor_type text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS address_street text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS address_city text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS address_state text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS address_zip text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS heard_about text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS invitation_sent_at timestamptz`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS invitation_from text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS owner_gross numeric`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS locations integer`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS employees integer`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS systems text`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS years_records integer`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_status text NOT NULL DEFAULT 'added'`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS questionnaire_answers jsonb`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS questionnaire_submission_id text`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_note text`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_updated_at timestamptz`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS client_code text`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS invite_code text`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS invited_by text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS payout_last4 text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_on_file boolean NOT NULL DEFAULT false`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS w9_uploaded_at timestamptz`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS tax_form_type text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_history jsonb`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS approved_amount numeric`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS approved_at timestamptz`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS desk_staff_band text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'partner-entered'`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS attribution_status text NOT NULL DEFAULT 'credited'`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS partner_code text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS business_city text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS business_state text NOT NULL DEFAULT ''`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS faststart_webinar_at timestamptz`
  ]) {
    await neonQuery(stmt);
  }
  state.tablesReady = true;
}

/* Normalised business key for first-to-register matching:
   lowercase, alphanumerics only, with trailing legal-suffix
   tokens (LLC, Inc, Corp, ...) stripped — "Globex Retail Group,
   Inc", "globex retail group" and "GLOBEX RETAIL GROUP LLC" all
   land on the same key. One business, one registration. */
const LEGAL_SUFFIXES = new Set(['llc', 'inc', 'corp', 'corporation', 'ltd', 'llp', 'lp', 'pc', 'pllc', 'co', 'company']);
export function businessKey(name) {
  const tokens = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('');
}

function rowToContractor(r) {
  if (!r) return null;
  return {
    id: r.id, email: r.email, name: r.name, company: r.company,
    status: r.status, ndaStatus: r.nda_status,
    agreementStatus: r.agreement_status || 'pending',
    agreementSignedAt: r.agreement_signed_at || null,
    agreementAcceptedName: r.agreement_accepted_name || '',
    agreementAcceptedVersion: r.agreement_accepted_version || '',
    agreementAcceptedVia: r.agreement_accepted_via || '',
    clientCode: r.client_code || '',
    inviteCode: r.invite_code || '',
    invitedBy: r.invited_by || '',
    payoutMethod: r.payout_method || '',
    payoutLast4: r.payout_last4 || '',
    w9OnFile: !!r.w9_on_file,
    w9UploadedAt: r.w9_uploaded_at || null,
    taxFormType: r.tax_form_type || '',
    activatedAt: r.activated_at || null, createdAt: r.created_at || null,
    invitationSentAt: r.invitation_sent_at || null,
    invitationFrom: r.invitation_from || '',
    faststartWebinarAt: r.faststart_webinar_at || null,
    source: r.source || 'office-invite',
    contractorType: r.contractor_type || '',
    phone: r.phone || '',
    addressStreet: r.address_street || '',
    addressCity: r.address_city || '',
    addressState: r.address_state || '',
    addressZip: r.address_zip || '',
    website: r.website || '',
    heardAbout: r.heard_about || '',
    notes: r.notes || ''
  };
}

function parseAnswers(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { const p = JSON.parse(String(v)); return p && typeof p === 'object' ? p : null; }
  catch { return null; }
}

function rowToReferral(r) {
  if (!r) return null;
  return {
    id: r.id, contractorId: r.contractor_id, businessName: r.business_name,
    ownerName: r.owner_name, ownerEmail: r.owner_email, industry: r.industry,
    status: r.status,
    licenseValue: r.license_value === null || r.license_value === undefined ? null : Number(r.license_value),
    ownerGross: r.owner_gross === null || r.owner_gross === undefined ? null : Number(r.owner_gross),
    feeAmount: r.fee_amount === null || r.fee_amount === undefined ? null : Number(r.fee_amount),
    feePaidAt: r.fee_paid_at || null, createdAt: r.created_at || null,
    locations: r.locations === null || r.locations === undefined ? null : Number(r.locations),
    employees: r.employees === null || r.employees === undefined ? null : Number(r.employees),
    systems: r.systems || null,
    yearsRecords: r.years_records === null || r.years_records === undefined ? null : Number(r.years_records),
    pipelineStatus: r.pipeline_status || 'added',
    pipelineHistory: parseHistory(r.pipeline_history),
    approvedAmount: r.approved_amount === null || r.approved_amount === undefined ? null : Number(r.approved_amount),
    approvedAt: r.approved_at || null,
    deskStaffBand: r.desk_staff_band || '',
    questionnaireAnswers: parseAnswers(r.questionnaire_answers),
    questionnaireSubmissionId: r.questionnaire_submission_id || null,
    pipelineNote: r.pipeline_note || null,
    pipelineUpdatedAt: r.pipeline_updated_at || null,
    source: r.source || 'partner-entered',
    attributionStatus: r.attribution_status || 'credited',
    partnerCode: r.partner_code || '',
    businessCity: r.business_city || '',
    businessState: r.business_state || ''
  };
}

/* Pipeline history: [{status, at, note}] — the dated status
   timeline the partner sees on a client's detail ("process time
   table"). Stored as jsonb; parsed defensively. */
function parseHistory(v) {
  const p = parseAnswers(v);
  if (!Array.isArray(p)) return [];
  return p.filter(e => e && typeof e === 'object' && e.status)
    .map(e => ({ status: String(e.status), at: e.at || null, note: e.note || null }));
}

function rowToLinkHold(r) {
  if (!r) return null;
  return {
    id: r.id, contractorId: r.contractor_id, clientCode: r.client_code || '',
    businessName: r.business_name, ownerName: r.owner_name,
    ownerEmail: r.owner_email, industry: r.industry || '',
    businessCity: r.business_city || '', businessState: r.business_state || '',
    questionnaireAnswers: parseAnswers(r.questionnaire_answers),
    questionnaireSubmissionId: r.questionnaire_submission_id || null,
    reason: r.reason || '', createdAt: r.created_at || null
  };
}

export async function createContractor(c) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO contractors (id, email, name, company, status, nda_status, activation_token_hash,
       source, phone, address_street, address_city, address_state, address_zip, website, heard_about, notes, contractor_type, invited_by)
     VALUES ($1, $2, $3, $4, 'invited', 'pending', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [c.id, c.email, c.name, c.company, c.activationTokenHash || '',
     c.source || 'office-invite', c.phone || '', c.addressStreet || '', c.addressCity || '',
     c.addressState || '', c.addressZip || '', c.website || '', c.heardAbout || '', c.notes || '',
     c.contractorType || '', c.invitedBy || '']);
  return true;
}

export async function readContractorById(id) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractors WHERE id = $1`, [id]);
  return rows.length ? rowToContractor(rows[0]) : null;
}

export async function readContractorByEmail(email) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractors WHERE email = $1`, [String(email).toLowerCase()]);
  return rows.length ? rowToContractor(rows[0]) : null;
}

export async function listContractors() {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractors ORDER BY created_at DESC LIMIT 200`);
  return rows.map(rowToContractor);
}

/* The stored activation-token hash for one contractor (the activate
   step compares against it). Kept out of the public row shape on
   purpose — the hash never leaves the server. */
export async function readActivationHash(contractorId) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT activation_token_hash FROM contractors WHERE id = $1`, [contractorId]);
  return rows.length ? rows[0].activation_token_hash : null;
}

/* Patch one contractor's status fields. `patch` keys: status,
   ndaStatus, agreementStatus, agreementSignedAt,
   agreementAcceptedName, agreementAcceptedVersion,
   agreementAcceptedVia, activationTokenHash, activatedAt,
   invitationSentAt, invitationFrom.
   Returns false when the row does not exist. Status transitions
   are enforced by the API layer, not here. */
export async function updateContractor(id, patch) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  const sets = [];
  const params = [];
  const map = { status: 'status', ndaStatus: 'nda_status', agreementStatus: 'agreement_status', agreementSignedAt: 'agreement_signed_at', agreementAcceptedName: 'agreement_accepted_name', agreementAcceptedVersion: 'agreement_accepted_version', agreementAcceptedVia: 'agreement_accepted_via', activationTokenHash: 'activation_token_hash', clientCode: 'client_code', inviteCode: 'invite_code', activatedAt: 'activated_at', invitationSentAt: 'invitation_sent_at', invitationFrom: 'invitation_from', payoutMethod: 'payout_method', payoutLast4: 'payout_last4', w9OnFile: 'w9_on_file', w9UploadedAt: 'w9_uploaded_at', taxFormType: 'tax_form_type', phone: 'phone', name: 'name', company: 'company', faststartWebinarAt: 'faststart_webinar_at', addressStreet: 'address_street', addressCity: 'address_city', addressState: 'address_state', addressZip: 'address_zip', website: 'website' };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { params.push(patch[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) return false;
  params.push(id);
  sets.push(`updated_at = now()`);
  const rows = await neonQuery(
    `UPDATE contractors SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows.length > 0;
}

/* First-to-register check: an earlier ACTIVE registration for the
   same business (normalised key) or the same owner email wins.
   Two simple lookups (one per key) keep the query surface small
   for the Neon HTTPS endpoint and for the test mock. Returns the
   earlier referral row or null.

   The IEC side of the same guard: companies IEC ITSELF has
   registered live in client_claims (office-maintained from the
   Desk admin). A match there blocks a partner registration the
   same way — the caller never learns which side matched. */
const ACTIVE_REFERRAL_STATUSES = ['registered', 'agreement_signed', 'license_closed', 'fee_paid'];
export async function findDuplicateReferral(businessName, ownerEmail) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const key = businessKey(businessName);
  const email = String(ownerEmail).toLowerCase();
  const byKey = await neonQuery(
    `SELECT * FROM contractor_referrals WHERE business_key = $1 ORDER BY created_at ASC LIMIT 1`,
    [key]);
  const byEmail = await neonQuery(
    `SELECT * FROM contractor_referrals WHERE owner_email = $1 ORDER BY created_at ASC LIMIT 1`,
    [email]);
  const candidates = [...byKey, ...byEmail]
    .map(rowToReferral)
    .filter(r => r && ACTIVE_REFERRAL_STATUSES.includes(r.status))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (candidates.length) return candidates[0];
  const claimByKey = await neonQuery(
    `SELECT * FROM client_claims WHERE business_key = $1 ORDER BY created_at ASC LIMIT 1`,
    [key]);
  if (claimByKey.length) return { id: claimByKey[0].id, claim: true };
  if (email) {
    const claimByEmail = await neonQuery(
      `SELECT * FROM client_claims WHERE owner_email = $1 ORDER BY created_at ASC LIMIT 1`,
      [email]);
    if (claimByEmail.length) return { id: claimByEmail[0].id, claim: true };
  }
  return null;
}

export async function createReferral(r) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  /* Seed the dated pipeline history: every referral starts at
     'added'; a link submission lands directly at
     questionnaire_answered, so its history records both events
     at the same instant (registration + questionnaire arrived
     together — that is what actually happened). */
  const startStatus = r.pipelineStatus || 'added';
  const nowIso = new Date().toISOString();
  const history = [{ status: 'added', at: nowIso, note: null }];
  if (startStatus !== 'added') history.push({ status: startStatus, at: nowIso, note: null });
  await neonQuery(
    `INSERT INTO contractor_referrals (id, contractor_id, business_name, business_key, owner_name, owner_email, industry, status, locations, employees, systems, years_records, pipeline_status, pipeline_history, desk_staff_band, questionnaire_answers, questionnaire_submission_id, source, attribution_status, partner_code, business_city, business_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'registered', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [r.id, r.contractorId, r.businessName, businessKey(r.businessName), r.ownerName, r.ownerEmail, r.industry,
     r.locations ?? null, r.employees ?? null, r.systems ?? null, r.yearsRecords ?? null,
     startStatus, JSON.stringify(history), r.deskStaffBand || '',
     r.questionnaireAnswers ? JSON.stringify(r.questionnaireAnswers) : null,
     r.questionnaireSubmissionId ?? null,
     r.source || 'partner-entered', r.attributionStatus || 'credited',
     r.partnerCode || '', r.businessCity || '', r.businessState || '']);
  return true;
}

/* Remove one referral — used ONLY as compensation when a linked
   questionnaire submission fails to store after the referral row
   was written (the two stores share one database in production,
   but the writes are sequential, not transactional). */
export async function deleteReferral(id) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(`DELETE FROM contractor_referrals WHERE id = $1`, [id]);
  return true;
}

/* ---------------------------------------------------------------- */
/* Partner client-link codes — the public …/r/<code> each active
   partner emails to his clients. 8 characters from an alphabet
   with no look-alikes (no 0/O, 1/I/L), generated with a CSPRNG and
   COLLISION-CHECKED against every issued code before it is
   stored. A code is a routing label, not a credential: knowing a
   code lets an owner register under that partner — exactly what
   the link is for — and nothing else.                          */
/* ---------------------------------------------------------------- */

export const PARTNER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PARTNER_CODE_LENGTH = 8;

export function generatePartnerClientCode(randomInt = crypto.randomInt) {
  let code = '';
  for (let i = 0; i < PARTNER_CODE_LENGTH; i++) {
    code += PARTNER_CODE_ALPHABET[randomInt(PARTNER_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizePartnerCode(code) {
  return String(code || '').trim().toUpperCase();
}

export async function readContractorByClientCode(code) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const normalized = normalizePartnerCode(code);
  if (!normalized) return null;
  const rows = await neonQuery(`SELECT * FROM contractors WHERE client_code = $1`, [normalized]);
  return rows.length ? rowToContractor(rows[0]) : null;
}

/* Issue (or return the existing) client-link code for one partner.
   Idempotent: a partner who already holds a code keeps it. The
   generator is injectable for tests. Returns the code, or '' when
   the partner does not exist / the store is unavailable. */
export async function ensureContractorClientCode(id, generate = generatePartnerClientCode) {
  if (!contractorsDbConfigured()) return '';
  const c = await readContractorById(id);
  if (!c) return '';
  if (c.clientCode) return c.clientCode;
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generate();
    const clash = await readContractorByClientCode(candidate);
    if (clash && clash.id !== id) continue;
    const ok = await updateContractor(id, { clientCode: candidate });
    if (ok) return candidate;
    return '';
  }
  return '';
}

/* Backfill: every partner who has been activated at some point
   (active, paused or revoked — 'invited' partners have not
   activated yet and get their code at activation) receives a code
   if he does not hold one. Returns the number of codes issued.
   Used by the Desk admin list (lazy, self-healing) and by
   scripts/backfill-partner-client-codes.mjs. */
const CODE_BACKFILL_STATUSES = ['active', 'paused', 'revoked'];
export async function backfillPartnerClientCodes() {
  if (!contractorsDbConfigured()) return 0;
  const all = await listContractors();
  let issued = 0;
  for (const c of all || []) {
    if (!CODE_BACKFILL_STATUSES.includes(c.status) || c.clientCode) continue;
    const code = await ensureContractorClientCode(c.id);
    if (code) issued++;
  }
  return issued;
}

/* ---------------------------------------------------------------- */
/* Partner INVITE codes — the standalone portal's flat partner
   invitation (…/join/<code>): a partner invites another partner
   DIRECTLY under IEC. There are no levels and no network: the
   code only records who invited whom (invited_by), so the
   inviter's portal can list the partners he personally brought
   in. Same generator and collision discipline as client codes;
   a separate column, so a client code never resolves as an
   invite code or the reverse. Issued at activation.           */
/* ---------------------------------------------------------------- */

export async function readContractorByInviteCode(code) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const normalized = normalizePartnerCode(code);
  if (!normalized) return null;
  const rows = await neonQuery(`SELECT * FROM contractors WHERE invite_code = $1`, [normalized]);
  return rows.length ? rowToContractor(rows[0]) : null;
}

export async function ensureContractorInviteCode(id, generate = generatePartnerClientCode) {
  if (!contractorsDbConfigured()) return '';
  const c = await readContractorById(id);
  if (!c) return '';
  if (c.inviteCode) return c.inviteCode;
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generate();
    const clashInvite = await readContractorByInviteCode(candidate);
    if (clashInvite && clashInvite.id !== id) continue;
    const clashClient = await readContractorByClientCode(candidate);
    if (clashClient && clashClient.id !== id) continue;
    const ok = await updateContractor(id, { inviteCode: candidate });
    if (ok) return candidate;
    return '';
  }
  return '';
}

/* The partners one partner personally invited (flat — direct
   invitees only, never a tree). */
export async function listContractorsByInviter(inviterId) {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(
    `SELECT * FROM contractors WHERE invited_by = $1 ORDER BY created_at DESC LIMIT 200`, [inviterId]);
  return rows.map(rowToContractor);
}

/* ---------------------------------------------------------------- */
/* contractor_link_holds — a registration that arrived through a
   partner's client link while the partner was NOT active. The
   submission is real (the owner answered IEC's questionnaire) but
   it is NOT the partner's referral: it waits here, flagged with
   the reason, for the Desk. It never enters fee totals and the
   partner's frozen view does not list it.                       */
/* ---------------------------------------------------------------- */

export async function createLinkHold(h) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO contractor_link_holds (id, contractor_id, client_code, business_name, business_key, owner_name, owner_email, industry, business_city, business_state, questionnaire_answers, questionnaire_submission_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [h.id, h.contractorId, h.clientCode || '', h.businessName, businessKey(h.businessName),
     h.ownerName, h.ownerEmail, h.industry || '', h.businessCity || '', h.businessState || '',
     h.questionnaireAnswers ? JSON.stringify(h.questionnaireAnswers) : null,
     h.questionnaireSubmissionId ?? null, h.reason || '']);
  return true;
}

export async function deleteLinkHold(id) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(`DELETE FROM contractor_link_holds WHERE id = $1`, [id]);
  return true;
}

export async function listLinkHolds() {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractor_link_holds ORDER BY created_at DESC LIMIT 200`);
  return rows.map(rowToLinkHold);
}

export async function readLinkHold(id) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractor_link_holds WHERE id = $1`, [id]);
  return rows.length ? rowToLinkHold(rows[0]) : null;
}

export async function listReferralsByContractor(contractorId) {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(
    `SELECT * FROM contractor_referrals WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 200`, [contractorId]);
  return rows.map(rowToReferral);
}

export async function listAllReferrals() {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractor_referrals ORDER BY created_at DESC LIMIT 200`);
  return rows.map(rowToReferral);
}

export async function readReferral(id) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractor_referrals WHERE id = $1`, [id]);
  return rows.length ? rowToReferral(rows[0]) : null;
}

/* Advance one referral. `patch` keys: status, licenseValue,
   ownerGross, feeAmount, feePaidAt (fee pipeline); locations, employees,
   systems, yearsRecords, pipelineStatus, questionnaireAnswers,
   questionnaireSubmissionId, pipelineNote, pipelineUpdatedAt
   (client profile + client pipeline). Forward-only transitions
   are enforced by the API layer, not here. */
export async function updateReferral(id, patch) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  const sets = [];
  const params = [];
  const map = {
    status: 'status', licenseValue: 'license_value', ownerGross: 'owner_gross', feeAmount: 'fee_amount', feePaidAt: 'fee_paid_at',
    locations: 'locations', employees: 'employees', systems: 'systems', yearsRecords: 'years_records',
    pipelineStatus: 'pipeline_status', questionnaireSubmissionId: 'questionnaire_submission_id',
    pipelineNote: 'pipeline_note', pipelineUpdatedAt: 'pipeline_updated_at',
    approvedAmount: 'approved_amount', approvedAt: 'approved_at', deskStaffBand: 'desk_staff_band'
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { params.push(patch[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (patch.questionnaireAnswers !== undefined) {
    params.push(patch.questionnaireAnswers ? JSON.stringify(patch.questionnaireAnswers) : null);
    sets.push(`questionnaire_answers = $${params.length}`);
  }
  if (patch.pipelineHistory !== undefined) {
    params.push(patch.pipelineHistory ? JSON.stringify(patch.pipelineHistory) : null);
    sets.push(`pipeline_history = $${params.length}`);
  }
  if (!sets.length) return false;
  params.push(id);
  sets.push(`updated_at = now()`);
  const rows = await neonQuery(
    `UPDATE contractor_referrals SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows.length > 0;
}

/* ---------------------------------------------------------------- */
/* client_claims — companies IEC itself has registered. The office
   maintains this list from the Desk admin; it is the IEC half of
   the duplicate guard. Seeded EMPTY and never faked: a company is
   here only when the office records it.                          */
/* ---------------------------------------------------------------- */

function rowToClaim(r) {
  if (!r) return null;
  return {
    id: r.id, businessName: r.business_name, ownerEmail: r.owner_email || '',
    note: r.note || '', createdAt: r.created_at || null
  };
}

export async function createClientClaim(c) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO client_claims (id, business_name, business_key, owner_email, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [c.id, c.businessName, businessKey(c.businessName), String(c.ownerEmail || '').toLowerCase(), c.note || '']);
  return true;
}

export async function listClientClaims() {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM client_claims ORDER BY created_at DESC LIMIT 500`);
  return rows.map(rowToClaim);
}

export async function deleteClientClaim(id) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(`DELETE FROM client_claims WHERE id = $1`, [id]);
  return true;
}

/* ---------------------------------------------------------------- */
/* contractor_tax_forms — the partner's tax form ON FILE (W-9 or
   W-8BEN), the same shape as DataSupply's payout tax-form upload:
   the file itself lives here, in the server-side store, and
   nowhere else. A re-upload replaces the row (one form on file
   per partner). readTaxForm returns the content and is called
   ONLY by the Desk-authenticated admin action — no partner-facing
   or public path ever serves the file.                          */
/* ---------------------------------------------------------------- */

function rowToTaxForm(r) {
  if (!r) return null;
  return {
    contractorId: r.contractor_id,
    formType: r.form_type || 'W-9',
    fileName: r.file_name || '',
    contentType: r.content_type || 'application/pdf',
    sizeBytes: r.size_bytes ?? 0,
    contentBase64: r.content_base64 || '',
    uploadedAt: r.uploaded_at || null
  };
}

export async function saveTaxForm(contractorId, form) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(`DELETE FROM contractor_tax_forms WHERE contractor_id = $1`, [contractorId]);
  await neonQuery(
    `INSERT INTO contractor_tax_forms (contractor_id, form_type, file_name, content_type, size_bytes, content_base64, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [contractorId, form.formType || 'W-9', form.fileName || '', form.contentType || 'application/pdf',
     form.sizeBytes || 0, form.contentBase64 || '', form.uploadedAt || new Date().toISOString()]);
  return true;
}

export async function readTaxForm(contractorId) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM contractor_tax_forms WHERE contractor_id = $1`, [contractorId]);
  return rows.length ? rowToTaxForm(rows[0]) : null;
}

/* ---------------------------------------------------------------- */
/* client_cnda_records — the partner-link client's IEC CNDA.
   Issued by the portal the moment a link owner's credentials are
   captured (questionnaire submitted): PRE-FILLED from the
   registration profile and PRE-SIGNED on the IEC side by
   Mohammed Morgan, MD. The owner countersigns on the portal's
   own signing surface (token-bound, one record per client); the
   executed copy (document_html, rendered server-side from the
   central instrument's text) lives HERE and nowhere else — the
   partner never sees it (his timeline shows the cnda_signed
   stage label only), and the only content route is the
   Desk-authenticated admin action, exactly like the tax form.
   A record attaches to a referral (credited) OR to a link hold
   (frozen partner — the signing waits with the hold, flagged
   for the Desk's ruling, never silently credited).            */
/* ---------------------------------------------------------------- */

function rowToClientCnda(r) {
  if (!r) return null;
  let signedValues = r.signed_values ?? null;
  if (typeof signedValues === 'string') {
    try { signedValues = JSON.parse(signedValues); } catch { signedValues = null; }
  }
  return {
    id: r.id,
    referralId: r.referral_id || null,
    holdId: r.hold_id || null,
    contractorId: r.contractor_id,
    tokenHash: r.token_hash || '',
    status: r.status || 'issued',
    businessName: r.business_name || '',
    signerName: r.signer_name || '',
    signerEmail: r.signer_email || '',
    businessCity: r.business_city || '',
    businessState: r.business_state || '',
    industry: r.industry || '',
    iecSignedName: r.iec_signed_name || '',
    iecSignedTitle: r.iec_signed_title || '',
    iecSignedAt: r.iec_signed_at || null,
    signedName: r.signed_name || '',
    signedTitle: r.signed_title || '',
    signedDate: r.signed_date || '',
    effectiveDate: r.effective_date || '',
    entityTypeState: r.entity_type_state || '',
    address: r.address || '',
    purpose: r.purpose || '',
    iecState: r.iec_state || '',
    typedSignature: r.typed_signature || '',
    signedValues,
    documentHtml: r.document_html || '',
    emailed: !!r.emailed,
    issuedAt: r.issued_at || null,
    signedAt: r.signed_at || null
  };
}

export async function createClientCnda(rec) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO client_cnda_records (id, referral_id, hold_id, contractor_id, token_hash, status,
       business_name, signer_name, signer_email, business_city, business_state, industry,
       iec_signed_name, iec_signed_title, iec_signed_at, emailed, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [rec.id, rec.referralId ?? null, rec.holdId ?? null, rec.contractorId, rec.tokenHash || '',
     rec.status || 'issued', rec.businessName || '', rec.signerName || '', rec.signerEmail || '',
     rec.businessCity || '', rec.businessState || '', rec.industry || '',
     rec.iecSignedName || '', rec.iecSignedTitle || '', rec.iecSignedAt || null,
     !!rec.emailed, rec.issuedAt || new Date().toISOString()]);
  return true;
}

export async function readClientCndaById(id) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM client_cnda_records WHERE id = $1`, [id]);
  return rows.length ? rowToClientCnda(rows[0]) : null;
}

export async function readClientCndaByReferral(referralId) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM client_cnda_records WHERE referral_id = $1`, [referralId]);
  return rows.length ? rowToClientCnda(rows[0]) : null;
}

export async function readClientCndaByHold(holdId) {
  if (!contractorsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM client_cnda_records WHERE hold_id = $1`, [holdId]);
  return rows.length ? rowToClientCnda(rows[0]) : null;
}

export async function listClientCndas() {
  if (!contractorsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT * FROM client_cnda_records ORDER BY issued_at DESC LIMIT 500`);
  return rows.map(rowToClientCnda);
}

export async function updateClientCnda(id, patch) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  const sets = [];
  const params = [];
  const map = {
    referralId: 'referral_id', holdId: 'hold_id', tokenHash: 'token_hash', status: 'status',
    iecSignedAt: 'iec_signed_at', signedName: 'signed_name', signedTitle: 'signed_title',
    signedDate: 'signed_date', effectiveDate: 'effective_date', entityTypeState: 'entity_type_state',
    address: 'address', purpose: 'purpose', iecState: 'iec_state', typedSignature: 'typed_signature',
    documentHtml: 'document_html', emailed: 'emailed', signedAt: 'signed_at'
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { params.push(patch[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (patch.signedValues !== undefined) {
    params.push(patch.signedValues ? JSON.stringify(patch.signedValues) : null);
    sets.push(`signed_values = $${params.length}`);
  }
  if (!sets.length) return false;
  params.push(id);
  const rows = await neonQuery(
    `UPDATE client_cnda_records SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows.length > 0;
}

export const _internals = { businessKey, rowToContractor, rowToReferral, rowToLinkHold, rowToTaxForm, rowToClientCnda, CODE_BACKFILL_STATUSES };
