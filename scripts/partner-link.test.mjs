/* Partner client-link test suite (2026-11-21): the per-partner
   public link …/r/<code> for the IEC Partner Portal —
   code generation (shape, uniqueness, collision retry), issuance
   at activation + backfill, the public resolve endpoint (partner
   named only while active, 3-day attribution cookie), template
   content rules, attribution on questionnaire submit (explicit
   code AND credit-window cookie), pipeline landing at
   questionnaire_answered with source 'link', duplicate refusal
   with nothing saved, identifier refusal with nothing saved, and
   the paused/revoked hold path (Desk-flagged, never credited).

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables shared by the contractors store and the questionnaire
   store — one database, as in production). No network, no Blob,
   no Resend.
   Run: node scripts/partner-link.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';

/* @vercel/blob is redirected to the in-memory mock (the same
   hooks scripts/questionnaire-submit.test.mjs uses) — the Blob
   store is only a silent backup for questionnaire submissions. */
register('./testing/blob-hooks.mjs', import.meta.url);

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'postgres://test:test@neon-sql.test/neondb';
process.env.QUESTIONNAIRE_DATABASE_URL = 'postgres://test:test@neon-sql.test/neondb';
process.env.BLOB_READ_WRITE_TOKEN = 'mock-blob-token';
delete process.env.DEMO_ADMIN_RESEND_API_KEY;

/* ---------------- mocked Neon SQL endpoint ---------------- */
const TABLES = {
  contractors: new Map(), contractor_referrals: new Map(),
  client_claims: new Map(), contractor_link_holds: new Map(),
  questionnaire_submissions: new Map()
};

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
      const pm = v.match(/^\$(\d+)/);
      if (pm) { if (params[Number(pm[1]) - 1] !== undefined) row[col] = params[Number(pm[1]) - 1]; }
      else if (/^'.*'$/.test(v)) row[col] = v.slice(1, -1);
      else if (v === 'now()') row[col] = new Date().toISOString();
    });
    if (row.created_at === undefined) row.created_at = new Date().toISOString();
    TABLES[table].set(row[cols[0]], row);
    if (table === 'questionnaire_submissions') return { rows: [{ reference: row.reference }] };
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
const contractorsMod = await import('../api/contractors.js');
const handler = contractorsMod.default;
const storeMod = await import('../api/_contractors-store.js');
const submitMod = await import('../api/questionnaire-submit.js');
const submitHandler = submitMod.default;

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
function partnerCookie(id, exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('hex');
  return `contractor_session=${id}.${exp}.${sig}`;
}
function mockRes() {
  return {
    statusCode: 0, payload: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    send(b) { this.payload = b; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    end(s) { this.payload = s; }
  };
}
async function call(method, action, { body, cookie, query } = {}) {
  const url = '/api/contractors' + (action ? `?action=${action}` : '') + (query ? `&${query}` : '');
  const req = { method, url, headers: cookie === null ? {} : { cookie: cookie ?? '' }, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}
async function submit(body, cookie) {
  const req = { method: 'POST', url: '/api/questionnaire-submit', headers: cookie ? { cookie } : {}, body };
  const res = mockRes();
  await submitHandler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/* ================= code generation ================= */
console.log('code generation');
{
  check('deterministic low generator -> AAAAAAAA', storeMod.generatePartnerClientCode(() => 0) === 'AAAAAAAA');
  check('deterministic high generator -> 99999999',
    storeMod.generatePartnerClientCode(n => n - 1) === '99999999');
  const seen = new Set();
  let shapeOk = true;
  for (let i = 0; i < 500; i++) {
    const c = storeMod.generatePartnerClientCode();
    if (!CODE_RE.test(c)) shapeOk = false;
    seen.add(c);
  }
  check('500 random codes: all 8 chars, unambiguous alphabet', shapeOk);
  check('500 random codes: all unique', seen.size === 500, seen.size);
}

/* ================= partner A: activation issues the code ================= */
console.log('issuance at activation');
let aId = null;
let aCode = null;
{
  await call('POST', 'register', { cookie: null, body: { name: 'Lena Link', email: 'lena@example.test', company: 'Lena Advisory LLC' } });
  aId = (await storeMod.readContractorByEmail('lena@example.test')).id;
  check('no code before activation', (await storeMod.readContractorById(aId)).clientCode === '');
  await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: aId, signed: true } });
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: aId, signed: true } });
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: aId } });
  const token = new URL(inv.payload.activationUrl).searchParams.get('token');
  const req = { method: 'GET', url: `/api/contractors?action=activate&token=${encodeURIComponent(token)}`, headers: {}, body: undefined };
  const res = mockRes();
  await handler(req, res);
  check('activation succeeds (302 to portal)', res.statusCode === 302 && res.headers.Location === '/contractors-portal.html', res.headers);
  const after = await storeMod.readContractorById(aId);
  aCode = after.clientCode;
  check('activation issued an 8-char code', CODE_RE.test(aCode), aCode);
  check('code resolves back to the partner', (await storeMod.readContractorByClientCode(aCode)).id === aId);
  check('ensure is idempotent (same code kept)', (await storeMod.ensureContractorClientCode(aId)) === aCode);
}
const aCookie = () => partnerCookie(aId);

/* ================= partner side: link + template on me ================= */
console.log('partner portal payload');
{
  const me = await call('GET', 'me', { cookie: aCookie() });
  check('me carries the client link', me.payload.clientLink === `https://iecincglobal.com/r/${aCode}`, me.payload.clientLink);
  const t = me.payload.clientLinkEmail || {};
  check('template subject is IEC-branded', /IEC/.test(t.subject || ''), t.subject);
  check('template carries the link', (t.body || '').includes(`https://iecincglobal.com/r/${aCode}`));
  check('template states the program range $100,000 to $5,000,000',
    (t.body || '').includes('$100,000') && (t.body || '').includes('$5,000,000'));
  check('template states the owner 80% share', (t.body || '').includes('80%'));
  check('template states license-not-sale + counts only',
    /not a sale/.test(t.body || '') && /counts only/i.test(t.body || ''));
  const all = `${t.subject}\n${t.body}`.toLowerCase();
  check('template names NO channel and NO partner fee',
    !all.includes('datasupply') && !all.includes('3%') && !all.includes('referral fee'), all.slice(0, 200));
}

/* ================= public resolve: active partner ================= */
console.log('link resolve + credit window');
let attributionCookie = '';
{
  const r = await call('GET', 'partner-link', { cookie: null, query: `code=${aCode}` });
  check('resolve ok for an active partner', r.statusCode === 200 && r.payload.ok && r.payload.attribution === 'active', r.payload);
  check('active partner is named for the landing', r.payload.partner && r.payload.partner.company === 'Lena Advisory LLC', r.payload.partner);
  const sc = String(r.headers['Set-Cookie'] || '');
  check('attribution cookie set for 3 days (Max-Age=259200, HttpOnly)',
    sc.startsWith('iec_partner_link=') && sc.includes('Max-Age=259200') && sc.includes('HttpOnly'), sc);
  attributionCookie = sc.split(';')[0];
  const bad = await call('GET', 'partner-link', { cookie: null, query: 'code=ZZZZZZZZ' });
  check('unknown code -> 404 invalid_link, no cookie',
    bad.statusCode === 404 && bad.payload.error === 'invalid_link' && !bad.headers['Set-Cookie'], bad.payload);
}

/* ================= submit through the link: credited ================= */
console.log('attributed submissions');
let sub1Id = null;
{
  const r = await submit({
    segment: 'general-business',
    contact: { name: 'Olivia Owner', business: 'Link Test Bakery LLC', email: 'olivia@linkbakery.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '1,200', 'Q14. Languages used with customers and in documentation (list all)': 'English' },
    partnerCode: aCode,
    partnerProfile: { businessName: 'Link Test Bakery LLC', city: 'Boston', state: 'MA' },
    company_website: ''
  });
  check('link submission accepted + credited', r.statusCode === 200 && r.payload.ok
    && r.payload.attribution && r.payload.attribution.source === 'link' && r.payload.attribution.status === 'credited', r.payload);
  sub1Id = r.payload.id;
  check('questionnaire submission stored', TABLES.questionnaire_submissions.has(sub1Id));
  const refs = await storeMod.listReferralsByContractor(aId);
  check('referral created under the partner', refs.length === 1, refs.length);
  const ref = refs[0];
  check('referral: source link, pipeline questionnaire_answered, submission id recorded',
    ref.source === 'link' && ref.pipelineStatus === 'questionnaire_answered'
    && ref.questionnaireSubmissionId === sub1Id, ref);
  check('referral: profile carried (city/state, industry from segment)',
    ref.businessCity === 'Boston' && ref.businessState === 'MA' && ref.industry === 'general-business', ref);
  check('referral: answers stored', ref.questionnaireAnswers && ref.questionnaireAnswers['Q8. Customers/clients served per year'] === '1,200', ref.questionnaireAnswers);
}
{
  // Credit window: no explicit code — the cookie from opening the
  // link  carries the attribution on its own.
  const r = await submit({
    segment: 'home-health',
    contact: { name: 'Henry Home', business: 'Window Care LLC', email: 'henry@windowcare.test', phone: '' },
    answers: { 'Q9. Active patients on census (current, count only)': '85' },
    partnerProfile: { businessName: 'Window Care LLC', city: 'Cambridge', state: 'MA' },
    company_website: ''
  }, attributionCookie);
  check('cookie-only submission credited inside the 3-day window',
    r.statusCode === 200 && r.payload.attribution && r.payload.attribution.status === 'credited', r.payload);
  const refs = await storeMod.listReferralsByContractor(aId);
  check('second referral landed under the same partner (segment mapped to industry)',
    refs.length === 2 && refs.some(x => x.businessName === 'Window Care LLC' && x.industry === 'home-health'), refs.map(x => x.businessName));
}

/* ================= duplicate + identifier: nothing saved ================= */
console.log('guards');
{
  const subsBefore = TABLES.questionnaire_submissions.size;
  const refsBefore = (await storeMod.listReferralsByContractor(aId)).length;
  const dup = await submit({
    segment: 'general-business',
    contact: { name: 'Someone Else', business: 'LINK TEST BAKERY, LLC', email: 'other@linkbakery.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '9,999' },
    partnerCode: aCode,
    partnerProfile: { businessName: 'LINK TEST BAKERY, LLC', city: 'Boston', state: 'MA' },
    company_website: ''
  });
  check('duplicate company via link -> 409 already_registered, no holder named',
    dup.statusCode === 409 && dup.payload.error === 'already_registered'
    && !JSON.stringify(dup.payload).includes('Lena'), dup.payload);
  check('duplicate stored NOTHING (no submission, no referral)',
    TABLES.questionnaire_submissions.size === subsBefore
    && (await storeMod.listReferralsByContractor(aId)).length === refsBefore);
  const ident = await submit({
    segment: 'general-business',
    contact: { name: 'Ida Identifier', business: 'Identifier Biz LLC', email: 'ida@idbiz.test', phone: '' },
    answers: { 'Q11. Call/email volume per month, if tracked (counts only)': 'call 617-555-0142 for counts' },
    partnerCode: aCode,
    partnerProfile: { businessName: 'Identifier Biz LLC', city: 'Boston', state: 'MA' },
    company_website: ''
  });
  check('identifier in an answer -> 400 identifier_content', ident.statusCode === 400 && ident.payload.error === 'identifier_content', ident.payload);
  check('identifier refusal stored NOTHING',
    TABLES.questionnaire_submissions.size === subsBefore
    && (await storeMod.listReferralsByContractor(aId)).length === refsBefore);
}

/* ================= paused, then revoked: held, never credited ================= */
console.log('held submissions');
{
  await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: aId, status: 'paused' } });
  const r = await call('GET', 'partner-link', { cookie: null, query: `code=${aCode}` });
  check('paused partner link still resolves, flagged held, partner NOT named',
    r.statusCode === 200 && r.payload.attribution === 'held' && r.payload.partner === null, r.payload);
  const meF = await call('GET', 'me', { cookie: aCookie() });
  check('paused partner portal serves NO working link/template',
    meF.payload.frozen === true && meF.payload.clientLink === '' && meF.payload.clientLinkEmail === null, meF.payload.clientLink);
  const held = await submit({
    segment: 'pharmacy',
    contact: { name: 'Paul Pharmacy', business: 'Held Pharmacy LLC', email: 'paul@heldpharmacy.test', phone: '' },
    answers: { 'Q10. Total prescriptions filled per year (last full year)': '42,000' },
    partnerCode: aCode,
    partnerProfile: { businessName: 'Held Pharmacy LLC', city: 'Quincy', state: 'MA' },
    company_website: ''
  });
  check('submission while paused is accepted as HELD', held.statusCode === 200
    && held.payload.attribution && held.payload.attribution.status === 'held', held.payload);
  check('held submission is NOT a referral (partner still has 2)',
    (await storeMod.listReferralsByContractor(aId)).length === 2);
  const holds = await storeMod.listLinkHolds();
  check('Desk hold recorded with reason + submission reference',
    holds.length === 1 && holds[0].businessName === 'Held Pharmacy LLC'
    && holds[0].reason === 'paused' && holds[0].questionnaireSubmissionId === held.payload.id
    && holds[0].clientCode === aCode, holds);
  const meH = await call('GET', 'me', { cookie: aCookie() });
  check('held company does NOT appear in the partner\u2019s clients',
    meH.payload.clients.length === 2 && !meH.payload.clients.some(c => c.businessName === 'Held Pharmacy LLC'));

  await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: aId, status: 'revoked' } });
  const held2 = await submit({
    segment: 'general-business',
    contact: { name: 'Rita Revoked', business: 'Revoked Link Biz LLC', email: 'rita@revokedbiz.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '300' },
    partnerCode: aCode,
    partnerProfile: { businessName: 'Revoked Link Biz LLC', city: 'Boston', state: 'MA' },
    company_website: ''
  });
  check('submission while revoked is HELD too', held2.statusCode === 200 && held2.payload.attribution.status === 'held', held2.payload);
  const holds2 = await storeMod.listLinkHolds();
  check('second hold recorded with reason revoked',
    holds2.length === 2 && holds2.some(h => h.reason === 'revoked'), holds2.map(h => h.reason));
}

/* ================= Desk view: codes, sources, holds ================= */
console.log('desk admin list');
{
  const admin = await call('GET', 'admin-list', { cookie: deskCookie() });
  const aRow = admin.payload.contractors.find(c => c.id === aId);
  check('admin list carries the partner code + link',
    aRow && aRow.clientCode === aCode && aRow.clientLink === `https://iecincglobal.com/r/${aCode}`, aRow && aRow.clientLink);
  check('admin referrals carry per-client source',
    admin.payload.referrals.filter(r => r.contractorId === aId).every(r => r.source === 'link')
    && admin.payload.referrals.length === 2, admin.payload.referrals.map(r => r.source));
  check('admin list carries the holds', Array.isArray(admin.payload.linkHolds) && admin.payload.linkHolds.length === 2,
    admin.payload.linkHolds && admin.payload.linkHolds.length);
}

/* ================= backfill: activated partners only ================= */
console.log('backfill');
let cId = null; let dId = null; let eId = null;
{
  await call('POST', 'register', { cookie: null, body: { name: 'Carl Current', email: 'carl@example.test', company: 'Carl LLC' } });
  cId = (await storeMod.readContractorByEmail('carl@example.test')).id;
  await storeMod.updateContractor(cId, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed' });
  await call('POST', 'register', { cookie: null, body: { name: 'TEST LIVEWALK Partner', email: 'livewalk@example.test', company: 'TEST LIVEWALK LLC' } });
  dId = (await storeMod.readContractorByEmail('livewalk@example.test')).id;
  await storeMod.updateContractor(dId, { status: 'revoked', ndaStatus: 'signed', agreementStatus: 'signed' });
  await call('POST', 'register', { cookie: null, body: { name: 'Erin Invited', email: 'erin@example.test', company: 'Erin LLC' } });
  eId = (await storeMod.readContractorByEmail('erin@example.test')).id;
  check('pre-backfill: none of the three holds a code',
    !(await storeMod.readContractorById(cId)).clientCode
    && !(await storeMod.readContractorById(dId)).clientCode
    && !(await storeMod.readContractorById(eId)).clientCode);
  await call('GET', 'admin-list', { cookie: deskCookie() });
  const cAfter = await storeMod.readContractorById(cId);
  const dAfter = await storeMod.readContractorById(dId);
  const eAfter = await storeMod.readContractorById(eId);
  check('backfill issued a code to the ACTIVE partner', CODE_RE.test(cAfter.clientCode), cAfter.clientCode);
  check('backfill issued a code to the REVOKED (previously activated) partner', CODE_RE.test(dAfter.clientCode), dAfter.clientCode);
  check('backfill did NOT issue a code to the merely INVITED partner', eAfter.clientCode === '', eAfter.clientCode);
  check('backfilled codes are distinct', cAfter.clientCode !== dAfter.clientCode && cAfter.clientCode !== aCode && dAfter.clientCode !== aCode);
}

/* ================= collision handling ================= */
console.log('collision handling');
{
  // Partner B (Carl, active, already coded) — re-issue path is
  // exercised through a partner with NO code: Erin is invited, so
  // issue directly against her record with a rigged generator
  // whose first candidate collides with Lena's code.
  const seq = [aCode, 'KMPQ27XZ'];
  let i = 0;
  const rigged = () => seq[Math.min(i++, seq.length - 1)];
  const issued = await storeMod.ensureContractorClientCode(eId, rigged);
  check('collision with an existing code is skipped, next candidate issued',
    issued === 'KMPQ27XZ' && i === 2, { issued, draws: i });
  check('the collided partner\u2019s code is untouched', (await storeMod.readContractorById(aId)).clientCode === aCode);
}

/* ================= static content rules ================= */
console.log('static content');
{
  const landing = await readFile(new URL('../partner-link.html', import.meta.url), 'utf8');
  check('landing is IEC-branded and states range + 80% share',
    landing.includes('IEC, Inc.') && landing.includes('$100,000 to $5,000,000') && landing.includes('80%'));
  check('landing names NO other brand/channel', !/datasupply/i.test(landing));
  check('landing carries the profile fields (legal name, type, owner, email, city, state)',
    ['pBusiness', 'pIndustry', 'pOwner', 'pEmail', 'pCity', 'pState'].every(id => landing.includes(`id="${id}"`)));
  const portal = await readFile(new URL('../contractors-portal.html', import.meta.url), 'utf8');
  check('portal has the client-link card + copy controls',
    portal.includes('Your client link') && portal.includes('copyLinkBtn') && portal.includes('copyTemplateBtn'));
  const form = await readFile(new URL('../questionnaire-form.html', import.meta.url), 'utf8');
  check('questionnaire form carries partnerCode + profile and the $100K–$5M range',
    form.includes('partnerCode') && form.includes('partnerProfile') && form.includes('$100K–$5M'));
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sources = (vercel.rewrites || []).map(r => r.source);
  check('vercel rewrites cover /r/:code and /w/p/:code',
    sources.includes('/r/:code') && sources.includes('/w/p/:code'), sources);
}

console.log(failures === 0 ? `\nALL GREEN — 0 failures` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
