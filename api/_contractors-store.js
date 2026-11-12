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
                          email UNIQUE)
     contractor_referrals one row per registered client (id PK)
     client_claims        companies IEC itself has registered —
                          the office-maintained half of the
                          duplicate guard (see findDuplicateReferral)

   COUNTS AND NAMES ONLY. A referral records the referred business
   and its owner contact — the identifiers IEC needs to register an
   introduction and to pay a fee. No patient or customer records,
   no counts documents, no PHI: nothing row-level is ever stored
   here. The fee schedule's money fields are integers (dollars).

   Status machines (forward-only; a step never moves backwards):
     contractor.status: invited -> active -> paused -> revoked
       ("invited" is never a settable target; revoked -> invited
       is expressly forbidden — same rule as api/demo-admin.js.)
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
    nda_status text NOT NULL DEFAULT 'pending',
    agreement_status text NOT NULL DEFAULT 'pending',
    agreement_signed_at timestamptz,
    activation_token_hash text NOT NULL DEFAULT '',
    activated_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS contractor_referrals (
    id text PRIMARY KEY, contractor_id text NOT NULL, business_name text NOT NULL,
    business_key text NOT NULL, owner_name text NOT NULL, owner_email text NOT NULL,
    industry text NOT NULL, status text NOT NULL DEFAULT 'registered',
    license_value numeric, fee_amount integer, fee_paid_at timestamptz,
    locations integer, employees integer, systems text, years_records integer,
    pipeline_status text NOT NULL DEFAULT 'added',
    questionnaire_answers jsonb, questionnaire_submission_id text,
    pipeline_note text, pipeline_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS client_claims (
    id text PRIMARY KEY, business_name text NOT NULL, business_key text NOT NULL,
    owner_email text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now())`);
  /* Upgrades for databases created before the Partner Portal
     extension: every added column, IF NOT EXISTS. */
  for (const stmt of [
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_status text NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE contractors ADD COLUMN IF NOT EXISTS agreement_signed_at timestamptz`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS locations integer`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS employees integer`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS systems text`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS years_records integer`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_status text NOT NULL DEFAULT 'added'`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS questionnaire_answers jsonb`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS questionnaire_submission_id text`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_note text`,
    `ALTER TABLE contractor_referrals ADD COLUMN IF NOT EXISTS pipeline_updated_at timestamptz`
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
    activatedAt: r.activated_at || null, createdAt: r.created_at || null
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
    feeAmount: r.fee_amount === null || r.fee_amount === undefined ? null : Number(r.fee_amount),
    feePaidAt: r.fee_paid_at || null, createdAt: r.created_at || null,
    locations: r.locations === null || r.locations === undefined ? null : Number(r.locations),
    employees: r.employees === null || r.employees === undefined ? null : Number(r.employees),
    systems: r.systems || null,
    yearsRecords: r.years_records === null || r.years_records === undefined ? null : Number(r.years_records),
    pipelineStatus: r.pipeline_status || 'added',
    questionnaireAnswers: parseAnswers(r.questionnaire_answers),
    questionnaireSubmissionId: r.questionnaire_submission_id || null,
    pipelineNote: r.pipeline_note || null,
    pipelineUpdatedAt: r.pipeline_updated_at || null
  };
}

export async function createContractor(c) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO contractors (id, email, name, company, status, nda_status, activation_token_hash)
     VALUES ($1, $2, $3, $4, 'invited', 'pending', $5)`,
    [c.id, c.email, c.name, c.company, c.activationTokenHash || '']);
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
   activationTokenHash, activatedAt. Returns false when the row
   does not exist. Status transitions are enforced by the API
   layer, not here. */
export async function updateContractor(id, patch) {
  if (!contractorsDbConfigured()) return false;
  await ensureTables();
  const sets = [];
  const params = [];
  const map = { status: 'status', ndaStatus: 'nda_status', agreementStatus: 'agreement_status', agreementSignedAt: 'agreement_signed_at', activationTokenHash: 'activation_token_hash', activatedAt: 'activated_at' };
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
  await neonQuery(
    `INSERT INTO contractor_referrals (id, contractor_id, business_name, business_key, owner_name, owner_email, industry, status, locations, employees, systems, years_records, pipeline_status, questionnaire_answers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'registered', $8, $9, $10, $11, 'added', $12)`,
    [r.id, r.contractorId, r.businessName, businessKey(r.businessName), r.ownerName, r.ownerEmail, r.industry,
     r.locations ?? null, r.employees ?? null, r.systems ?? null, r.yearsRecords ?? null,
     r.questionnaireAnswers ? JSON.stringify(r.questionnaireAnswers) : null]);
  return true;
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
   feeAmount, feePaidAt (fee pipeline); locations, employees,
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
    status: 'status', licenseValue: 'license_value', feeAmount: 'fee_amount', feePaidAt: 'fee_paid_at',
    locations: 'locations', employees: 'employees', systems: 'systems', yearsRecords: 'years_records',
    pipelineStatus: 'pipeline_status', questionnaireSubmissionId: 'questionnaire_submission_id',
    pipelineNote: 'pipeline_note', pipelineUpdatedAt: 'pipeline_updated_at'
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) { params.push(patch[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (patch.questionnaireAnswers !== undefined) {
    params.push(patch.questionnaireAnswers ? JSON.stringify(patch.questionnaireAnswers) : null);
    sets.push(`questionnaire_answers = $${params.length}`);
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

export const _internals = { businessKey, rowToContractor, rowToReferral };
