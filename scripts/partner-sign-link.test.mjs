/* Partner Portal SIGN-FROM-LINK suite (Nov 25, 2026 —
   DrMorgan's order: "either they can sign from link or I can
   send invitation").

   Covers BOTH doors:
   - Sign link: sign-start creates/resumes a record and mints
     the 24h single-purpose signing token; sign-cnda and
     sign-agreement serve the full instruments and record
     portal evidence (typed name + timestamp + version);
     sign-complete emails the activation link (mailbox
     ownership), consumes the signing token, and the emailed
     link activates through the unchanged gate.
   - Invitation: accept-nda mirrors accept-agreement so an
     invited partner signs the CNDA in-portal with evidence;
     office-recorded set-nda still works and shows no portal
     evidence.
   Token purpose isolation: a signing token never activates,
   never reads partner data, and never works at the activation
   actions; an activation token never works at the signing
   actions. Documents: a portal signer's CNDA copy renders his
   portal evidence and the restated Entry 1 he actually signed
   (no banned names); an office-recorded copy keeps the office
   line. Rate limiting on sign-start. No-introduction gate:
   activation refuses until BOTH signatures stand, on both
   doors.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables) and for Resend (captured payloads). No real
   database, no network, no real email.
   Run: node scripts/partner-sign-link.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-signlink-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'postgres://test:test@neon-sql.test/neondb';
process.env.DEMO_ADMIN_RESEND_API_KEY = 'test-resend-key';

/* ---------------- mocked Neon SQL endpoint ---------------- */
const TABLES = { contractors: new Map(), contractor_referrals: new Map(), client_claims: new Map() };

function neonSql(query, params) {
  const q = query.replace(/\s+/g, ' ').trim();
  if (/^CREATE TABLE IF NOT EXISTS/.test(q)) return { rows: [] };
  if (/^ALTER TABLE/.test(q)) return { rows: [] };
  let m = q.match(/^DELETE FROM (\w+) WHERE (\w+) = \$(\d+)$/);
  if (m) { TABLES[m[1]].delete(params[Number(m[3]) - 1]); return { rows: [] }; }
  m = q.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/);
  if (m) {
    const [, table, colsRaw, valsRaw] = m;
    const cols = colsRaw.split(',').map(s => s.trim());
    const vals = valsRaw.split(',').map(s => s.trim());
    const row = {};
    cols.forEach((col, i) => {
      const v = vals[i];
      if (v === undefined) return;
      const pm = v.match(/^\$(\d+)$/);
      if (pm) { if (params[Number(pm[1]) - 1] !== undefined) row[col] = params[Number(pm[1]) - 1]; }
      else if (/^'.*'$/.test(v)) row[col] = v.slice(1, -1);
      else if (v === 'now()') row[col] = new Date().toISOString();
    });
    if (row.created_at === undefined) row.created_at = new Date().toISOString();
    TABLES[table].set(row[cols[0]], row);
    return { rows: [] };
  }
  m = q.match(/^SELECT \* FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY .+?)?(?: LIMIT \d+)?$/);
  if (m) {
    const [, table, where] = m;
    let rows = [...TABLES[table].values()];
    if (where) {
      const ors = where.split(' OR ').map(s => s.trim());
      rows = rows.filter(r => ors.some(cond => {
        const cm = cond.match(/^(\w+) = \$(\d+)$/);
        if (cm) return String(r[cm[1]]) === String(params[Number(cm[2]) - 1]);
        return false;
      }));
    }
    return { rows };
  }
  m = q.match(/^SELECT (\w+) FROM (\w+) WHERE (\w+) = \$1$/);
  if (m) {
    const [, col, table, whereCol] = m;
    const rows = [...TABLES[table].values()].filter(r => String(r[whereCol]) === String(params[0]));
    return { rows: rows.map(r => ({ [col]: r[col] })) };
  }
  m = q.match(/^UPDATE (\w+) SET (.+) WHERE (\w+) = \$(\d+) RETURNING \*/);
  if (m) {
    const [, table, setRaw, whereCol, whereIdx] = m;
    const id = params[Number(whereIdx) - 1];
    const row = TABLES[table].get(id);
    if (!row) return { rows: [] };
    setRaw.split(',').forEach(part => {
      const sm = part.trim().match(/^(\w+) = \$(\d+)$/);
      if (sm) row[sm[1]] = params[Number(sm[2]) - 1];
    });
    return { rows: [row] };
  }
  throw new Error(`unmocked SQL: ${q.slice(0, 100)}`);
}

const EMAILS = [];
const jsonRes = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  if (u === 'https://api.resend.com/emails') {
    EMAILS.push(JSON.parse(opts.body));
    return jsonRes(200, { id: `test-email-${EMAILS.length}` });
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const mod = await import('../api/contractors.js');
const handler = mod.default;
const storeMod = await import('../api/_contractors-store.js');
const docsMod = await import('../api/_partner-documents.js');
const cndaContent = await import('../api/_cnda-content.js');
const restatement = await import('../api/_cnda-restatement.js');

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
async function call(method, action, { body, cookie, query } = {}) {
  const url = '/api/contractors' + (action ? `?action=${action}` : '') + (query ? `&${query}` : '');
  const req = { method, url, headers: cookie === null ? {} : { cookie: cookie ?? '' }, body };
  const res = {
    statusCode: 0, payload: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    send(b) { this.payload = b; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    end(s) { this.payload = s; }
  };
  await handler(req, res);
  return res;
}
async function rawActivate(token) {
  const req = { method: 'GET', url: `/api/contractors?action=activate&token=${encodeURIComponent(token)}`, headers: {}, body: undefined };
  const res = {
    statusCode: 0, payload: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    end(s) { this.payload = s; }
  };
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

const PROFILE = (name, email, company) => ({
  name, email, company, contractorType: 'Consulting', phone: '617-555-0100',
  street: '1 Main St', city: 'Boston', state: 'MA', zip: '02136'
});

/* ================= sign-start: create, honeypot, validation ================= */
console.log('sign-start');
let saraToken = null;
let saraId = null;
{
  const hp = await call('POST', 'sign-start', { cookie: null, body: { ...PROFILE('Botty McBot', 'bot@example.test', 'Bot Co'), company_site_hp: 'spam' } });
  check('honeypot tripped -> 400 rejected', hp.statusCode === 400 && hp.payload.error === 'rejected', hp.payload);
  check('honeypot created no record', !(await storeMod.readContractorByEmail('bot@example.test')));
  const badType = await call('POST', 'sign-start', { cookie: null, body: { ...PROFILE('Bad Type', 'badtype@example.test', 'Bad Co'), contractorType: 'Wizardry' } });
  check('unknown contractor type -> 400', badType.statusCode === 400 && badType.payload.error === 'invalid_fields', badType.payload);
  const badEmail = await call('POST', 'sign-start', { cookie: null, body: PROFILE('Bad Email', 'not-an-email', 'Bad Co') });
  check('invalid email -> 400', badEmail.statusCode === 400 && badEmail.payload.error === 'invalid_fields', badEmail.payload);

  const r = await call('POST', 'sign-start', { cookie: null, body: PROFILE('Sara Lindqvist', 'sara@example.test', 'Lindqvist Advisory LLC') });
  check('sign-start creates the record and returns the signing token',
    r.statusCode === 200 && r.payload.ok && !!r.payload.token && r.payload.next === 'cnda'
    && r.payload.ndaStatus === 'pending' && r.payload.agreementStatus === 'pending', r.payload);
  saraToken = r.payload.token;
  const row = await storeMod.readContractorByEmail('sara@example.test');
  saraId = row.id;
  check('record state: invited, source sign-link, both pending',
    row.status === 'invited' && row.source === 'sign-link' && row.ndaStatus === 'pending'
    && row.agreementStatus === 'pending', row);
  check('signing hash stored (the raw token is not in the row shape)',
    !!(await storeMod.readSigningHash(saraId)) && !JSON.stringify(row).includes(saraToken));
}

/* ================= token purpose isolation ================= */
console.log('token purpose isolation');
{
  const act = await rawActivate(saraToken);
  check('signing token at activate -> 401 (never activates)', act.statusCode === 401, act.payload);
  const me = await call('GET', 'me', { cookie: `contractor_session=${saraToken}` });
  check('signing token as a session cookie -> 401 (never reads partner data)', me.statusCode === 401, me.payload);
  const acc = await call('POST', 'accept-agreement', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist', accept: true } });
  check('signing token at accept-agreement -> 401', acc.statusCode === 401, acc.payload);
  const accNda = await call('POST', 'accept-nda', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist', accept: true } });
  check('signing token at accept-nda -> 401', accNda.statusCode === 401, accNda.payload);
  const agr = await call('GET', 'agreement', { cookie: null, query: `token=${encodeURIComponent(saraToken)}` });
  check('signing token at agreement GET -> 401', agr.statusCode === 401, agr.payload);
  const bogus = await call('GET', 'sign-cnda', { cookie: null, query: 'token=deadbeef.9999999999.deadbeef' });
  check('bogus token at sign-cnda -> 401', bogus.statusCode === 401, bogus.payload);
  const none = await call('GET', 'sign-cnda', { cookie: null });
  check('no token at sign-cnda -> 401', none.statusCode === 401, none.payload);
}

/* ================= the CNDA step ================= */
console.log('sign-cnda');
{
  const g = await call('GET', 'sign-cnda', { cookie: null, query: `token=${encodeURIComponent(saraToken)}` });
  check('sign-cnda serves the filled central text + version',
    g.statusCode === 200 && g.payload.ok && g.payload.version === cndaContent.CNDA_TEXT_SHA256
    && g.payload.ndaStatus === 'pending' && g.payload.acceptance === null, g.payload && g.payload.version);
  const allText = (g.payload.sections || []).map(s => s.text).join('\n');
  check('sections carry the signer identity filled in (party name present, placeholder gone)',
    allText.includes('Lindqvist Advisory LLC') && !allText.includes('[COUNTERPARTY NAME]'));
  check('served CNDA carries no banned names (the text of record new signers sign)',
    restatement.CNDA_BANNED_NAMES.every(b => !allText.includes(b)), restatement.CNDA_BANNED_NAMES.filter(b => allText.includes(b)));
  check('the blank execution block is not served for reading',
    !(g.payload.sections || []).some(s => s.title === 'Execution'));

  const wrong = await call('POST', 'sign-cnda', { cookie: null, body: { token: saraToken, typedName: 'Sara L.', accept: true } });
  check('mismatched typed name -> 400 name_mismatch', wrong.statusCode === 400 && wrong.payload.error === 'name_mismatch', wrong.payload);
  const noBox = await call('POST', 'sign-cnda', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist' } });
  check('accept flag missing -> 400', noBox.statusCode === 400 && noBox.payload.error === 'invalid_fields', noBox.payload);
  check('failed attempts record NOTHING (CNDA still pending)',
    (await storeMod.readContractorById(saraId)).ndaStatus === 'pending');

  const r = await call('POST', 'sign-cnda', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist', accept: true } });
  check('valid CNDA signature -> 200, next is the agreement',
    r.statusCode === 200 && r.payload.ok && r.payload.ndaStatus === 'signed' && r.payload.next === 'agreement', r.payload);
  const row = await storeMod.readContractorById(saraId);
  check('CNDA evidence stored: typed name + timestamp + version + via portal',
    row.ndaStatus === 'signed' && row.ndaAcceptedName === 'Sara Lindqvist'
    && row.ndaAcceptedVia === 'portal' && row.ndaVersion === cndaContent.CNDA_TEXT_SHA256
    && !!row.ndaSignedAt, row);
  const again = await call('POST', 'sign-cnda', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist', accept: true } });
  check('a second CNDA signature is a no-op (alreadySigned)',
    again.statusCode === 200 && again.payload.alreadySigned === true
    && again.payload.acceptance && again.payload.acceptance.name === 'Sara Lindqvist', again.payload);
}

/* ================= sign-complete gate: agreement still pending ================= */
console.log('sign-complete gate');
{
  const r = await call('POST', 'sign-complete', { cookie: null, body: { token: saraToken } });
  check('sign-complete with the agreement unsigned -> 409 signatures_pending',
    r.statusCode === 409 && r.payload.error === 'signatures_pending' && r.payload.next === 'agreement', r.payload);
  check('no email was sent for the refused completion', EMAILS.length === 0);
  check('the signing token survives the refused completion',
    !!(await storeMod.readSigningHash(saraId)));
}

/* ================= the Agreement step ================= */
console.log('sign-agreement');
{
  const g = await call('GET', 'sign-agreement', { cookie: null, query: `token=${encodeURIComponent(saraToken)}` });
  check('sign-agreement serves the full agreement + fee schedule',
    g.statusCode === 200 && g.payload.ok && g.payload.html.includes('EXHIBIT A')
    && g.payload.html.includes('5. Compensation') && !!g.payload.schedule, g.payload && g.payload.version);
  const wrong = await call('POST', 'sign-agreement', { cookie: null, body: { token: saraToken, typedName: 'Someone Else', accept: true } });
  check('mismatched typed name -> 400 name_mismatch', wrong.statusCode === 400 && wrong.payload.error === 'name_mismatch', wrong.payload);
  const r = await call('POST', 'sign-agreement', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist', accept: true } });
  check('valid acceptance -> 200, next is complete',
    r.statusCode === 200 && r.payload.ok && r.payload.agreementStatus === 'signed' && r.payload.next === 'complete', r.payload);
  const row = await storeMod.readContractorById(saraId);
  check('agreement evidence stored exactly like the invitation door',
    row.agreementAcceptedVia === 'portal' && row.agreementAcceptedName === 'Sara Lindqvist'
    && !!row.agreementAcceptedVersion && !!row.agreementSignedAt, row);
  const again = await call('POST', 'sign-agreement', { cookie: null, body: { token: saraToken, typedName: 'Sara Lindqvist', accept: true } });
  check('a second acceptance is a no-op (alreadySigned)', again.statusCode === 200 && again.payload.alreadySigned === true, again.payload);
}

/* ================= completion: the emailed activation link ================= */
console.log('sign-complete');
let saraSession = null;
{
  const r = await call('POST', 'sign-complete', { cookie: null, body: { token: saraToken } });
  check('sign-complete -> 200, emailed, next activate; NO activation URL in the response',
    r.statusCode === 200 && r.payload.ok && r.payload.emailed === true && r.payload.next === 'activate'
    && !JSON.stringify(r.payload).includes('action=activate'), r.payload);
  check('two emails: the partner activation link + the office notification', EMAILS.length === 2, EMAILS.map(e => e.subject));
  const partnerMail = EMAILS.find(e => (e.to || []).includes('sara@example.test'));
  const officeMail = EMAILS.find(e => (e.to || []).includes('info@iecincglobal.com'));
  check('partner email carries the activation link from info@',
    partnerMail && partnerMail.from.includes('info@iecincglobal.com')
    && partnerMail.text.includes('action=activate&token='), partnerMail && partnerMail.subject);
  check('office notification names the signing (full profile pattern)',
    officeMail && officeMail.subject.includes('signed from the sign link')
    && officeMail.text.includes('Lindqvist Advisory LLC'), officeMail && officeMail.subject);
  check('signing token consumed at completion', !(await storeMod.readSigningHash(saraId)));
  const dead = await call('GET', 'sign-cnda', { cookie: null, query: `token=${encodeURIComponent(saraToken)}` });
  check('the consumed signing token no longer resolves (401)', dead.statusCode === 401, dead.payload);
  check('activation hash stored from the successful send', !!(await storeMod.readActivationHash(saraId)));

  const actToken = new URL(partnerMail.text.match(/https?:\/\/\S*action=activate&token=\S+/)[0]).searchParams.get('token');
  const cross = await call('GET', 'sign-cnda', { cookie: null, query: `token=${encodeURIComponent(actToken)}` });
  check('the activation token never works at the signing actions (401)', cross.statusCode === 401, cross.payload);
  const open = await rawActivate(actToken);
  check('the emailed link activates (302 + session cookie)',
    open.statusCode === 302 && String(open.headers['Set-Cookie'] || '').startsWith('contractor_session='), open.headers);
  saraSession = String(open.headers['Set-Cookie'] || '').split(';')[0];
  const row = await storeMod.readContractorById(saraId);
  check('partner is active with codes issued', row.status === 'active' && !!row.clientCode && !!row.inviteCode, row);
}

/* ================= the signed-in view ================= */
console.log('signed-in view');
{
  const me = await call('GET', 'me', { cookie: saraSession });
  check('me carries BOTH portal acceptances',
    me.statusCode === 200 && me.payload.agreementAccepted && me.payload.agreementAccepted.via === 'portal'
    && me.payload.ndaAccepted && me.payload.ndaAccepted.via === 'portal'
    && me.payload.ndaAccepted.name === 'Sara Lindqvist', me.payload && me.payload.ndaAccepted);
  const cnda = await call('GET', 'my-cnda', { cookie: saraSession });
  check('my-cnda serves the signed copy with portal acceptance',
    cnda.statusCode === 200 && cnda.payload.acceptance && cnda.payload.acceptance.via === 'portal'
    && cnda.payload.html.includes('Signed in the IEC Partner Portal'), cnda.payload && cnda.payload.acceptance);
  const pdf = await call('GET', 'my-cnda-pdf', { cookie: saraSession });
  check('my-cnda-pdf serves a PDF', pdf.statusCode === 200 && String(pdf.headers['content-type'] || '').includes('application/pdf'), pdf.headers);
}

/* ================= documents: portal evidence vs office line ================= */
console.log('documents');
{
  const sara = await storeMod.readContractorById(saraId);
  const doc = docsMod.partnerCndaDocument(sara);
  check('portal signer copy: typed signature + version + timestamp rendered',
    doc && doc.html.includes('Sara Lindqvist') && doc.html.includes(cndaContent.CNDA_TEXT_SHA256)
    && doc.acceptance && doc.acceptance.via === 'portal');
  check('portal signer copy: NO banned names (he signed the restated Entry 1)',
    restatement.CNDA_BANNED_NAMES.every(b => !doc.html.includes(b)), restatement.CNDA_BANNED_NAMES.filter(b => doc.html.includes(b)));
  const blocksText = doc.blocks.map(b => b.text).join('\n');
  check('portal signer PDF blocks carry the same evidence',
    blocksText.includes('Signed in the IEC Partner Portal by') && blocksText.includes('Sara Lindqvist'));

  await call('POST', 'register', { cookie: null, body: { name: 'Paper Pete', email: 'pete@example.test', company: 'Pete Paper Co' } });
  const peteId = (await storeMod.readContractorByEmail('pete@example.test')).id;
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: peteId, signed: true } });
  const pete = await storeMod.readContractorById(peteId);
  const pdoc = docsMod.partnerCndaDocument(pete);
  check('office-recorded copy: office line, NO portal evidence invented',
    pdoc && pdoc.html.includes('recorded on the partner') && !pdoc.html.includes('Signed in the IEC Partner Portal by')
    && pdoc.acceptance === null);
  check('office set-nda stores no portal evidence fields',
    (pete.ndaAcceptedVia || '') === '' && (pete.ndaAcceptedName || '') === '' && !pete.ndaSignedAt, pete);
}

/* ================= resume, duplicate, revoked, attribution ================= */
console.log('resume + duplicate + attribution');
{
  const first = await call('POST', 'sign-start', { cookie: null, body: PROFILE('Rita Resume', 'rita@example.test', 'Resume Co') });
  const second = await call('POST', 'sign-start', { cookie: null, body: { ...PROFILE('Rita Changed', 'rita@example.test', 'Changed Co'), phone: '617-555-0199' } });
  check('second sign-start resumes the same record',
    second.statusCode === 200 && second.payload.resumed === true
    && second.payload.contractor.name === 'Rita Resume' && second.payload.contractor.company === 'Resume Co', second.payload);
  const ritaRow = await storeMod.readContractorByEmail('rita@example.test');
  check('resume refreshes contact fields but NOT the identity of record',
    ritaRow.name === 'Rita Resume' && ritaRow.company === 'Resume Co' && ritaRow.phone === '617-555-0199', ritaRow);
  const oldDead = await call('GET', 'sign-cnda', { cookie: null, query: `token=${encodeURIComponent(first.payload.token)}` });
  check('the superseded signing token is dead (401)', oldDead.statusCode === 401, oldDead.payload);
  const newAlive = await call('GET', 'sign-cnda', { cookie: null, query: `token=${encodeURIComponent(second.payload.token)}` });
  check('the fresh signing token resolves (200)', newAlive.statusCode === 200, newAlive.payload && newAlive.payload.ok);

  const dup = await call('POST', 'sign-start', { cookie: null, body: PROFILE('Sara Lindqvist', 'sara@example.test', 'Lindqvist Advisory LLC') });
  check('fully-signed email -> 409 already_registered (the existing answer)',
    dup.statusCode === 409 && dup.payload.error === 'already_registered', dup.payload);

  await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: ritaRow.id, status: 'revoked' } });
  const rev = await call('POST', 'sign-start', { cookie: null, body: PROFILE('Rita Resume', 'rita@example.test', 'Resume Co') });
  check('revoked record -> 409 already_registered (office handles revocations)',
    rev.statusCode === 409 && rev.payload.error === 'already_registered', rev.payload);

  const saraRow = await storeMod.readContractorById(saraId);
  const via = await call('POST', 'sign-start', { cookie: null, body: { ...PROFILE('Ivy Invited', 'ivy@example.test', 'Ivy Co'), inviteCode: saraRow.inviteCode } });
  const ivyRow = await storeMod.readContractorByEmail('ivy@example.test');
  check('invite code attributes the new signer to the inviter (flat)',
    via.statusCode === 200 && ivyRow.invitedBy === saraId, ivyRow && ivyRow.invitedBy);
  const viaBad = await call('POST', 'sign-start', { cookie: null, body: { ...PROFILE('Noah Nobody', 'noah@example.test', 'Noah Co'), inviteCode: 'ZZZZ9999' } });
  const noahRow = await storeMod.readContractorByEmail('noah@example.test');
  check('unknown invite code is ignored, never an error',
    viaBad.statusCode === 200 && (noahRow.invitedBy || '') === '', viaBad.payload);
}

/* ================= rate limiting ================= */
console.log('rate limiting');
{
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = await call('POST', 'sign-start', { cookie: null, body: PROFILE('Flood Fred', 'flood@example.test', 'Flood Co') });
  }
  check('the 6th sign-start for one email inside the window -> 429',
    last.statusCode === 429 && last.payload.error === 'rate_limited', last.payload);
}

/* ================= the invitation door: accept-nda ================= */
console.log('invitation door (accept-nda)');
{
  await call('POST', 'register', { cookie: null, body: { name: 'Nadia Nda', email: 'nadia@example.test', company: 'Nadia Co' } });
  const nadiaId = (await storeMod.readContractorByEmail('nadia@example.test')).id;
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: nadiaId } });
  const token = new URL(inv.payload.activationUrl).searchParams.get('token');
  const g = await call('GET', 'nda', { cookie: null, query: `token=${encodeURIComponent(token)}` });
  check('nda GET serves the filled CNDA to the link holder',
    g.statusCode === 200 && g.payload.ok && g.payload.ndaStatus === 'pending'
    && (g.payload.sections || []).some(s => s.text.includes('Nadia Co')), g.payload && g.payload.ndaStatus);
  const badTok = await call('GET', 'nda', { cookie: null, query: 'token=deadbeef.9999999999.deadbeef' });
  check('nda GET with a bogus token -> 401', badTok.statusCode === 401, badTok.payload);
  const wrong = await call('POST', 'accept-nda', { cookie: null, body: { token, typedName: 'Nadia N.', accept: true } });
  check('mismatched typed name -> 400 name_mismatch', wrong.statusCode === 400 && wrong.payload.error === 'name_mismatch', wrong.payload);
  const r = await call('POST', 'accept-nda', { cookie: null, body: { token, typedName: 'Nadia Nda', accept: true } });
  check('accept-nda -> 200, next is the agreement',
    r.statusCode === 200 && r.payload.ok && r.payload.ndaStatus === 'signed' && r.payload.next === 'agreement', r.payload);
  const row = await storeMod.readContractorById(nadiaId);
  check('invitation-door CNDA evidence stored (portal)',
    row.ndaAcceptedVia === 'portal' && row.ndaAcceptedName === 'Nadia Nda'
    && row.ndaVersion === cndaContent.CNDA_TEXT_SHA256 && !!row.ndaSignedAt, row);
  const again = await call('POST', 'accept-nda', { cookie: null, body: { token, typedName: 'Nadia Nda', accept: true } });
  check('a second accept-nda is a no-op (alreadySigned)', again.statusCode === 200 && again.payload.alreadySigned === true, again.payload);
  const refused = await rawActivate(token);
  check('the gate still refuses activation while the agreement is unsigned',
    refused.statusCode === 302 && !refused.headers['Set-Cookie'], refused.headers);
  await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: 'Nadia Nda', accept: true } });
  const open = await rawActivate(token);
  check('both signed in-portal -> the invitation link activates',
    open.statusCode === 302 && String(open.headers['Set-Cookie'] || '').startsWith('contractor_session='), open.headers);
  check('invited partner is active', (await storeMod.readContractorById(nadiaId)).status === 'active');
}

console.log(failures === 0 ? '\npartner-sign-link.test.mjs: ALL GREEN' : `\npartner-sign-link.test.mjs: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
