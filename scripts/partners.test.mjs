/* Partner Portal test suite: the Partner Portal extension of
   api/contractors.js — agreement+NDA activation gate, add-client
   with profile + counts-only questionnaire answers, identifier
   refusal, the IEC-claims duplicate guard, the 8-stage client
   pipeline (strict order, evidence-gated), server-side scoping,
   frozen partners, and fee totals.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables). No real database, no network.
   Run: node scripts/partners.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'postgres://test:test@neon-sql.test/neondb';

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

const jsonRes = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const mod = await import('../api/contractors.js');
const handler = mod.default;
const storeMod = await import('../api/_contractors-store.js');
const qMod = await import('../api/_partner-questionnaire.js');

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
function partnerCookie(id, exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('hex');
  return `contractor_session=${id}.${exp}.${sig}`;
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

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

/* ================= questionnaire module ================= */
console.log('questionnaire field set');
check('approved set has 17 fields in 5 sections',
  qMod.QUESTIONNAIRE_FIELDS.length === 17 && qMod.QUESTIONNAIRE_SECTIONS.length === 5);
{
  const good = qMod.validateQuestionnaireAnswers({ q8: '1,240', q10: { 'From year': '2009', 'Customer records (years)': '16' }, q12: ['Billing', 'Sales/intake'] });
  check('valid answers normalise to the public-form storage shape',
    good.ok && good.answers['Q8. Customers/clients served per year'] === '1,240'
    && good.answers['Q10. Years of history stored:'] === 'From year: 2009 · Customer records (years): 16'
    && good.answers['Q12. Do written SOPs exist for:'] === 'Billing, Sales/intake', good);
  const ssn = qMod.validateQuestionnaireAnswers({ q8: 'patient 123-45-6789 has 40 visits' });
  check('SSN in an answer -> identifier_content', !ssn.ok && ssn.error === 'identifier_content');
  const email = qMod.validateQuestionnaireAnswers({ q7: 'contact ana@acme.test for the counts' });
  check('email in an answer -> identifier_content', !email.ok && email.error === 'identifier_content');
  const phone = qMod.validateQuestionnaireAnswers({ q11: 'call 617-555-0142 monthly' });
  check('phone in an answer -> identifier_content', !phone.ok && phone.error === 'identifier_content');
  const unknown = qMod.validateQuestionnaireAnswers({ q99: 'x' });
  check('unknown question key -> invalid_answers', !unknown.ok && unknown.error === 'invalid_answers');
  const badSub = qMod.validateQuestionnaireAnswers({ q6: { 'Patient names': 'x' } });
  check('unknown sub-field -> invalid_answers', !badSub.ok && badSub.error === 'invalid_answers');
}

/* ================= partner lifecycle + signing gate ================= */
console.log('partner lifecycle');
let karimId = null;
{
  const r = await call('POST', 'register', { cookie: null, body: { name: 'Karim Haddad', email: 'karim@example.test', company: 'Karim Consulting LLC' } });
  check('partner registers (request access)', r.statusCode === 200 && r.payload.ok, r.payload);
  karimId = (await storeMod.readContractorByEmail('karim@example.test')).id;
  check('agreement + NDA both pending at registration',
    (await storeMod.readContractorById(karimId)).agreementStatus === 'pending');
}
let token = null;
{
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: karimId } });
  token = new URL(inv.payload.activationUrl).searchParams.get('token');
  const req = { method: 'GET', url: `/api/contractors?action=activate&token=${encodeURIComponent(token)}`, headers: {}, body: undefined };
  const res = { statusCode: 0, payload: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, end(s) { this.payload = s; } };
  await handler(req, res);
  check('activation before signing routes to the agreement page (302, no session, link not consumed)',
    res.statusCode === 302 && String(res.headers.Location || '').startsWith('/contractors-agreement.html?t=')
    && !res.headers['Set-Cookie'], res.headers);
  await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: karimId, signed: true } });
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: karimId, signed: true } });
  const res2 = { statusCode: 0, payload: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, end(s) { this.payload = s; } };
  await handler(req, res2);
  check('activation succeeds after both signatures, same link', res2.statusCode === 302, { status: res2.statusCode });
  check('partner is active', (await storeMod.readContractorById(karimId)).status === 'active');
}
const karim = () => partnerCookie(karimId);

/* ================= add client: profile + answers ================= */
console.log('add client');
let clientId = null;
{
  const r = await call('POST', 'register-referral', {
    cookie: karim(),
    body: {
      businessName: 'Harbor Dental Group', ownerName: 'Lena Ortiz', ownerEmail: 'lena@harbordental.test',
      industry: 'medical-practice', locations: 2, employees: 34,
      systems: 'Dentrix, Microsoft 365, QuickBooks', yearsRecords: 14,
      questionnaireAnswers: { q8: '6,800', q9: '9,100', q14: 'English, Spanish' }
    }
  });
  check('client added with profile + answers', r.statusCode === 200 && r.payload.ok && r.payload.pipelineStatus === 'added', r.payload);
  clientId = r.payload.clientId;
  const row = await storeMod.readReferral(clientId);
  check('profile stored (locations/employees/systems/years)',
    row.locations === 2 && row.employees === 34 && row.systems.includes('Dentrix') && row.yearsRecords === 14, row);
  check('answers stored in form shape',
    row.questionnaireAnswers && row.questionnaireAnswers['Q8. Customers/clients served per year'] === '6,800', row.questionnaireAnswers);
}
{
  // Identifier-carrying answers: refused, and NOTHING is stored.
  const r = await call('POST', 'register-referral', {
    cookie: karim(),
    body: {
      businessName: 'Bad Data LLC', ownerName: 'Bob', ownerEmail: 'bob@baddata.test', industry: 'pharmacy',
      questionnaireAnswers: { q8: 'patient SSN 123-45-6789' }
    }
  });
  check('identifier answers -> 400 identifier_content', r.statusCode === 400 && r.payload.error === 'identifier_content', r.payload);
  const me = await call('GET', 'me', { cookie: karim() });
  check('refused client was NOT stored', me.payload.clients.length === 1, me.payload.clients.map(c => c.businessName));
}

/* ================= duplicate guard: partner vs IEC claim ================= */
console.log('duplicate guard');
let claimId = null;
{
  const a = await call('POST', 'add-claim', { cookie: deskCookie(), body: { businessName: 'Globex Retail Group', ownerEmail: 'ops@globex.test', note: 'Registered by IEC directly' } });
  check('admin records an IEC-registered company', a.statusCode === 200 && a.payload.ok, a.payload);
  claimId = a.payload.claimId;
  const r = await call('POST', 'register-referral', {
    cookie: karim(),
    body: { businessName: 'GLOBEX RETAIL GROUP, INC', ownerName: 'Someone', ownerEmail: 'other@globex.test', industry: 'general-business' }
  });
  check('partner add matching an IEC claim -> 409, no side named',
    r.statusCode === 409 && r.payload.error === 'already_registered'
    && JSON.stringify(r.payload).toLowerCase().includes('claim') === false
    && JSON.stringify(r.payload).toLowerCase().includes('iec') === false, r.payload);
  const rm = await call('POST', 'remove-claim', { cookie: deskCookie(), body: { claimId } });
  check('claim removal ok', rm.statusCode === 200 && rm.payload.ok);
  const r2 = await call('POST', 'register-referral', {
    cookie: karim(),
    body: { businessName: 'Globex Retail Group', ownerName: 'Gus Globex', ownerEmail: 'ops@globex.test', industry: 'general-business' }
  });
  check('after claim removal the add succeeds', r2.statusCode === 200 && r2.payload.ok, r2.payload);
}

/* ================= scoping ================= */
console.log('scoping');
let omarId = null;
{
  await call('POST', 'register', { cookie: null, body: { name: 'Omar Farouk', email: 'omar@example.test', company: 'Omar Advisory' } });
  omarId = (await storeMod.readContractorByEmail('omar@example.test')).id;
  await storeMod.updateContractor(omarId, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed' });
  const g = await call('GET', 'get-client', { cookie: partnerCookie(omarId), query: `id=${clientId}` });
  check("another partner reading Karim's client -> 404 (no existence leak)", g.statusCode === 404, g.payload);
  const u = await call('POST', 'update-client', { cookie: partnerCookie(omarId), body: { clientId, employees: 99 } });
  check("another partner updating Karim's client -> 404", u.statusCode === 404, u.payload);
  const meO = await call('GET', 'me', { cookie: partnerCookie(omarId) });
  check("Omar's dashboard lists only his own clients (0)", meO.payload.clients.length === 0, meO.payload.clients);
  const mine = await call('GET', 'get-client', { cookie: karim(), query: `id=${clientId}` });
  check('owner partner reads his client', mine.statusCode === 200 && mine.payload.client.businessName === 'Harbor Dental Group', mine.payload);
  check('partner payloads name no channel and no other party',
    JSON.stringify(mine.payload).toLowerCase().includes('datasupply') === false
    && JSON.stringify(mine.payload).toLowerCase().includes('janise') === false
    && JSON.stringify(meO.payload).toLowerCase().includes('datasupply') === false);
}

/* ================= update + send questionnaire ================= */
console.log('update + questionnaire step');
{
  const u = await call('POST', 'update-client', { cookie: karim(), body: { clientId, employees: 36 } });
  check('partner corrects his client while at added', u.statusCode === 200 && u.payload.client.employees === 36, u.payload);
  const s = await call('POST', 'send-questionnaire', { cookie: karim(), body: { clientId } });
  check('send-questionnaire advances to questionnaire_sent',
    s.statusCode === 200 && s.payload.client.pipelineStatus === 'questionnaire_sent', s.payload);
  const u2 = await call('POST', 'update-client', { cookie: karim(), body: { clientId, employees: 40 } });
  check('after the questionnaire is out, the record locks (409 client_locked)', u2.statusCode === 409 && u2.payload.error === 'client_locked', u2.payload);
  const s2 = await call('POST', 'send-questionnaire', { cookie: karim(), body: { clientId } });
  check('send-questionnaire twice -> 409', s2.statusCode === 409);
}
{
  // PT industry maps to the form's "pt" segment slug.
  const add = await call('POST', 'register-referral', {
    cookie: karim(),
    body: { businessName: 'Summit Physical Therapy', ownerName: 'Pam Reed', ownerEmail: 'pam@summitpt.test', industry: 'physical-therapy' }
  });
  const s = await call('POST', 'send-questionnaire', { cookie: karim(), body: { clientId: add.payload.clientId } });
  check('physical-therapy questionnaire URL uses the pt segment',
    s.statusCode === 200 && s.payload.questionnaireUrl.includes('segment=pt'), s.payload);
}

/* ================= client pipeline: strict order + evidence ================= */
console.log('client pipeline');
{
  const skip = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: clientId, status: 'assessment_done', evidence: 'x' } });
  check('skipping a pipeline step -> 409', skip.statusCode === 409 && skip.payload.error === 'invalid_transition', skip.payload);
  const noEv = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: clientId, status: 'questionnaire_answered' } });
  check('questionnaire_answered without evidence -> 400 evidence_required',
    noEv.statusCode === 400 && noEv.payload.error === 'evidence_required', noEv.payload);
  const qa = await call('POST', 'advance-client', {
    cookie: deskCookie(),
    body: { referralId: clientId, status: 'questionnaire_answered', evidence: 'Submission landed in Dana\u2019s database, matched by business + owner email', submissionId: 'qs-2026-1187' }
  });
  check('questionnaire_answered with the submission reference -> 200, id stored',
    qa.statusCode === 200 && qa.payload.client.pipelineStatus === 'questionnaire_answered'
    && qa.payload.client.questionnaireSubmissionId === 'qs-2026-1187', qa.payload);
  const steps = [
    ['assessment_done', 'Data Asset Builder run DAB-2214 — valued'],
    ['cnda_sent', null],
    ['cnda_signed', 'Countersigned copy opened and read; signature + date confirmed'],
    ['ready_to_register', null],
    ['registered', null]
  ];
  let last = null;
  for (const [st, ev] of steps) {
    last = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: clientId, status: st, evidence: ev || undefined } });
    if (last.statusCode !== 200) break;
  }
  check('pipeline walks to registered, one real step at a time',
    last && last.statusCode === 200 && last.payload.client.pipelineStatus === 'registered', last && last.payload);
  const back = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: clientId, status: 'cnda_sent' } });
  check('pipeline never moves backwards (409)', back.statusCode === 409);
}

/* ================= fee totals ================= */
console.log('fee totals');
{
  const close = await call('POST', 'advance-referral', { cookie: deskCookie(), body: { referralId: clientId, status: 'agreement_signed' } });
  check('fee pipeline: agreement_signed', close.statusCode === 200, close.payload);
  const lic = await call('POST', 'advance-referral', { cookie: deskCookie(), body: { referralId: clientId, status: 'license_closed', licenseValue: 500000, ownerGross: 500000 } });
  check('owner gross $500,000 -> partner fee $25,000 (5%, no cap)', lic.statusCode === 200 && lic.payload.referral.ownerGross === 500000 && lic.payload.referral.feeAmount === 25000, lic.payload);
  const me = await call('GET', 'me', { cookie: karim() });
  check('partner fee totals: earned 25000, paid 0, outstanding 25000',
    me.payload.feeTotals.earned === 25000 && me.payload.feeTotals.paid === 0 && me.payload.feeTotals.outstanding === 25000, me.payload.feeTotals);
  const pay = await call('POST', 'advance-referral', { cookie: deskCookie(), body: { referralId: clientId, status: 'fee_paid' } });
  check('fee marked paid', pay.statusCode === 200 && pay.payload.referral.status === 'fee_paid', pay.payload);
  const admin = await call('GET', 'admin-list', { cookie: deskCookie() });
  const karimRow = admin.payload.contractors.find(c => c.id === karimId);
  check('admin list carries per-partner fee totals',
    karimRow && karimRow.feeTotals.earned === 25000 && karimRow.feeTotals.paid === 25000, karimRow && karimRow.feeTotals);
}

/* ================= frozen partner ================= */
console.log('frozen partner');
{
  // Globex is Karim's second client, still at 'added'.
  const me = await call('GET', 'me', { cookie: karim() });
  const globex = me.payload.clients.find(c => c.businessName === 'Globex Retail Group');
  await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: karimId, status: 'paused' } });
  const adv = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: globex.id, status: 'questionnaire_sent' } });
  check('a paused partner\u2019s pipeline does not move (409 partner_frozen)',
    adv.statusCode === 409 && adv.payload.error === 'partner_frozen', adv.payload);
  const sq = await call('POST', 'send-questionnaire', { cookie: karim(), body: { clientId: globex.id } });
  check('paused partner cannot write (401)', sq.statusCode === 401, sq.payload);
  const meF = await call('GET', 'me', { cookie: karim() });
  check('paused partner keeps the frozen view of his clients',
    meF.statusCode === 200 && meF.payload.frozen === true && meF.payload.clients.length === 3, meF.payload.frozen);
  await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: karimId, status: 'revoked' } });
  const meR = await call('GET', 'me', { cookie: karim() });
  check('revoked partner still sees his clients, frozen',
    meR.statusCode === 200 && meR.payload.frozen === true && meR.payload.contractor.status === 'revoked'
    && meR.payload.clients.length === 3, meR.payload.contractor);
}

console.log(failures === 0 ? `\nALL GREEN — 0 failures` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
