/* Partner Portal — sign-in card + CNDA Schedule B Entry 1
   restatement (Eleanor's ruling + DrMorgan's sign-in order,
   Nov 22, 2026). Covers:
   1. The restated Entry 1 is the CNDA text of record for new
      signers (verbatim, no proper names anywhere in it).
   2. An existing signer's rendered CNDA: as-signed Entry 1
      before Section 5.3 effectiveness; restated Entry 1 +
      provenance line after it; an objected partner stays
      as-signed.
   3. The sealed Identification Record is imported by no handler.
   4. The Section 5.3 delivery notice draft (never sent here).
   5. The sign-in card path: POST signin with the activation
      code, and with a pasted full link — session set, dashboard
      (me) opens; spent / bogus credentials get the plain-
      language answer; signatures still precede activation.
   Run: node scripts/partner-portal-signin-restatement.test.mjs */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'https://neon-sql.test/sql';
delete process.env.DEMO_ADMIN_RESEND_API_KEY;

const TABLES = {
  contractors: new Map(), contractor_referrals: new Map(),
  client_claims: new Map(), contractor_link_holds: new Map(),
  questionnaire_submissions: new Map(), contractor_tax_forms: new Map(),
  client_cnda_records: new Map()
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

const mod = await import('../api/contractors.js');
const handler = mod.default;
const storeMod = await import('../api/_contractors-store.js');
const cndaContent = await import('../api/_cnda-content.js');
const rest = await import('../api/_cnda-restatement.js');
const docsMod = await import('../api/_partner-documents.js');

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
function mockRes() {
  return {
    statusCode: 0, payload: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    send(b) { this.payload = b; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    getHeader(k) { return this.headers[k]; },
    end(s) { this.payload = s; }
  };
}
async function call(method, action, { body, cookie, query } = {}) {
  const url = '/api/contractors' + (action ? `?action=${action}` : '') + (query ? `&${query}` : '');
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const req = { method, url, headers, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}
const BANNED = ['DataSupply', 'Chang Strategic', 'NexMed', 'Tom Schaefer'];

/* ============ 1. text of record for new signers ============ */
console.log('CNDA text of record');
{
  const joined = cndaContent.CNDA_TEXTS.join('\n');
  check('restated Entry 1 is in the text of record verbatim', joined.includes(rest.ENTRY1_RESTATED));
  for (const b of BANNED) check(`no banned name in CNDA text of record: ${b}`, !joined.includes(b));
  check('business days: Fri 2026-11-20 + 5 = Fri 2026-11-27', rest.addBusinessDays('2026-11-20', 5) === '2026-11-27', rest.addBusinessDays('2026-11-20', 5));
  check('business days: Mon 2026-11-02 + 5 = Mon 2026-11-09', rest.addBusinessDays('2026-11-02', 5) === '2026-11-09');
}

/* ============ 2. sealed record isolation ============ */
console.log('sealed identification record');
{
  for (const f of ['api/contractors.js', 'api/_partner-documents.js', 'api/_client-cnda.js', 'partners/app.js', 'partners/cnda.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    check(`${f} never references the sealed record`, !src.includes('_cnda-identification-record') && !src.includes('IDENTIFICATION_RECORD'));
  }
  const sealed = await import('../api/_cnda-identification-record.js');
  check('sealed record maps description to full legal identity', sealed.IDENTIFICATION_RECORD.internal === true
    && sealed.IDENTIFICATION_RECORD.fullLegalIdentity.includes('Chang Strategic Ltd.')
    && sealed.IDENTIFICATION_RECORD.functionalDescription.includes('data-licensing channel'));
}

/* ============ helper: a fully-signed partner ============ */
async function makeSignedPartner(name, email, company) {
  await call('POST', 'register', { body: { name, email, company } });
  const id = (await storeMod.readContractorByEmail(email)).id;
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: id } });
  const token = inv.payload.activationUrl.split('token=')[1];
  await call('POST', 'accept-agreement', { body: { token, typedName: name, accept: true } });
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: id, signed: true } });
  return { id, token };
}

/* ============ 3. sign-in card path ============ */
console.log('sign-in card');
{
  const { id, token } = await makeSignedPartner('Signin Sue', 'signin-sue@example.test', 'Sue Co');
  const bogus = await call('POST', 'signin', { body: { credential: 'not-a-real-code' } });
  check('bogus credential: 401 with plain-language re-issue answer', bogus.statusCode === 401
    && bogus.payload.message.includes('info@iecincglobal.com') && !bogus.payload.message.includes('invalid_token'), bogus.payload);
  const ok = await call('POST', 'signin', { body: { credential: token } });
  check('code sign-in succeeds and sets the session cookie', ok.statusCode === 200 && ok.payload.next === 'dashboard'
    && String(ok.headers['Set-Cookie'] || '').startsWith('contractor_session='), ok.payload);
  const cookie = String(ok.headers['Set-Cookie']).split(';')[0];
  const me = await call('GET', 'me', { cookie });
  check('dashboard opens: me returns the partner', me.statusCode === 200 && me.payload.ok && me.payload.contractor.id === id, me.statusCode);
  const spent = await call('POST', 'signin', { body: { credential: token } });
  check('spent credential is refused (one-time)', spent.statusCode === 401, spent.statusCode);

  const p2 = await makeSignedPartner('Link Larry', 'link-larry@example.test', 'Larry Co');
  const link = `https://partners.iecincglobal.com/api/contractors?action=activate&token=${p2.token}`;
  const ok2 = await call('POST', 'signin', { body: { credential: link } });
  check('pasted full activation link signs in', ok2.statusCode === 200 && ok2.payload.next === 'dashboard', ok2.payload);

  /* signatures still precede activation via the card */
  await call('POST', 'register', { body: { name: 'Unsigned Uma', email: 'unsigned-uma@example.test', company: 'Uma Co' } });
  const umaId = (await storeMod.readContractorByEmail('unsigned-uma@example.test')).id;
  const invU = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: umaId } });
  const tokenU = invU.payload.activationUrl.split('token=')[1];
  const early = await call('POST', 'signin', { body: { credential: tokenU } });
  check('unsigned partner is routed to the agreement step, no session', early.statusCode === 200 && early.payload.next === 'agreement'
    && !early.headers['Set-Cookie'], early.payload);
  const meU = await call('GET', 'me', { cookie: '' });
  check('no partner data without a session (401)', meU.statusCode === 401, meU.statusCode);
}

/* ============ 4. restatement rendering paths ============ */
console.log('restatement rendering');
{
  const { id, token } = await makeSignedPartner('Restate Rita', 'restate-rita@example.test', 'Rita Co');
  const act = await call('GET', 'activate', { query: 'token=' + encodeURIComponent(token) });
  const cookie = String(act.headers['Set-Cookie'] || '').split(';')[0];
  const before = await call('GET', 'my-cnda', { cookie });
  check('pre-effectiveness: Entry 1 renders as signed', before.statusCode === 200 && before.payload.html.includes('Chang Strategic Ltd.'), before.statusCode);
  check('pre-effectiveness: no provenance line', !before.payload.html.includes('as restated under Section 5.3; delivered'));

  const notice = await call('GET', 'admin-cnda-restatement-notice', { cookie: deskCookie(), query: 'contractorId=' + id + '&deliveredDate=2026-11-02' });
  check('notice draft: identifies Agreement, §5.3 delivery, verbatim entry, deadline', notice.statusCode === 200
    && notice.payload.notice.text.includes('Section 5.3') && notice.payload.notice.text.includes(rest.ENTRY1_RESTATED)
    && notice.payload.notice.deadline === '2026-11-09', notice.payload && notice.payload.notice);

  const rec = await call('POST', 'admin-cnda-restatement', { cookie: deskCookie(), body: { contractorId: id, deliveredDate: '2026-11-02' } });
  check('delivery recorded with computed effective date', rec.statusCode === 200 && rec.payload.restatement.deliveredDate === '2026-11-02'
    && rec.payload.restatement.effectiveDate === '2026-11-09', rec.payload);
  const after = await call('GET', 'my-cnda', { cookie });
  check('post-effectiveness: restated Entry 1 renders', after.payload.html.includes('as restated under Section 5.3'));
  check('post-effectiveness: provenance line with delivered + effective dates', after.payload.html.includes('delivered 2026-11-02; effective 2026-11-09')
    && after.payload.html.includes('The executed original is held by IEC.'));
  for (const b of BANNED) check(`post-effectiveness render carries no banned name: ${b}`, !after.payload.html.includes(b));
  const pdf = await call('GET', 'my-cnda-pdf', { cookie });
  check('post-effectiveness PDF generated', pdf.statusCode === 200, pdf.statusCode);

  const obj = await makeSignedPartner('Objecting Omar', 'objecting-omar@example.test', 'Omar Co');
  await call('POST', 'admin-cnda-restatement', { cookie: deskCookie(), body: { contractorId: obj.id, deliveredDate: '2026-11-02' } });
  await call('POST', 'admin-cnda-restatement', { cookie: deskCookie(), body: { contractorId: obj.id, objected: true } });
  const rec2 = await storeMod.readContractorById(obj.id);
  const doc2 = docsMod.partnerCndaDocument(rec2);
  check('objected partner stays as-signed', !!doc2 && doc2.html.includes('Chang Strategic Ltd.') && !doc2.html.includes('provenance') && !doc2.html.includes('as restated under Section 5.3; delivered'));
}

/* ============ 5. front-door wiring (static) ============ */
console.log('front-door wiring');
{
  const app = readFileSync(new URL('../partners/app.js', import.meta.url), 'utf8');
  check('sign-in card form is on the front door', app.includes('pp-signin-form') && app.includes("action: 'signin'"));
  check('EN + ES sign-in strings exist', app.includes('Sign in to my portal') && app.includes('Ingresar a mi portal'));
  const en = readFileSync(new URL('../contractors.html', import.meta.url), 'utf8');
  const es = readFileSync(new URL('../es/contractors.html', import.meta.url), 'utf8');
  check('entrance buttons land on the portal (sign-in card host)', en.includes('https://partners.iecincglobal.com') && es.includes('https://partners.iecincglobal.com'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL GREEN — 0 failures');
process.exit(failures ? 1 : 0);
