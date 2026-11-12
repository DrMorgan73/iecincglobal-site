/* Partner Portal PUBLIC SIGN-UP suite: POST /api/contractors?action=signup —
   the full-profile request-access form on contractors.html.

   Covers: happy path creates the COMPLETE record (invited, agreement +
   NDA pending, source 'public-signup', every profile field stored);
   the office notification carries the full profile; the admin-list
   serialization returns every field; the sign-first activation gate
   covers a self-registered partner identically (403 signing_required
   before signatures, 302 after); duplicate email -> 409
   already_registered; honeypot (company_site_hp) -> 400 rejected and
   nothing stored; the real website field does NOT trip the trap;
   bad email / missing required -> 400; a missing or unknown
   contractor type -> 400 (the type is required — the portal serves
   IEC contractors generally); mailer failure still stores
   (emailed:false); minimal signup (required fields only) succeeds.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory tables)
   and for Resend. No real database, no network, no real email.
   Run: node scripts/partners-signup.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-partner-secret';
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

/* ---------------- mocked Resend ---------------- */
let resendMode = 'ok';
const sentEmails = [];
const jsonRes = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  if (u === 'https://api.resend.com/emails') {
    if (resendMode === 'fail') return jsonRes(500, { message: 'boom' });
    sentEmails.push(JSON.parse(opts.body));
    return jsonRes(200, { id: 're_test_123' });
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const mod = await import('../api/contractors.js');
const handler = mod.default;
const storeMod = await import('../api/_contractors-store.js');

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
async function activate(token) {
  const req = { method: 'GET', url: `/api/contractors?action=activate&token=${encodeURIComponent(token)}`, headers: {}, body: undefined };
  const res = { statusCode: 0, payload: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, end(s) { this.payload = s; } };
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

const FULL = {
  name: 'Ana Ruiz', company: 'Ruiz Advisory Group LLC', email: 'Ana@RuizAdvisory.test',
  contractorType: 'Data network introductions',
  phone: '617-555-0142', street: '44 Canal Street, Suite 9', city: 'Boston', state: 'MA', zip: '02114',
  website: 'https://ruizadvisory.example', heardAbout: 'Referred by a current IEC partner',
  notes: 'Focus on dental practices in New England.', company_site_hp: ''
};

/* ================= happy path: the COMPLETE record ================= */
console.log('public sign-up — full profile');
let anaId = null;
{
  const r = await call('POST', 'signup', { cookie: null, body: FULL });
  check('full signup -> 200 ok, emailed:true', r.statusCode === 200 && r.payload.ok === true && r.payload.emailed === true, r.payload);
  const row = await storeMod.readContractorByEmail('ana@ruizadvisory.test');
  anaId = row && row.id;
  check('record is invited with agreement + NDA pending',
    row && row.status === 'invited' && row.ndaStatus === 'pending' && row.agreementStatus === 'pending', row);
  check("source tagged 'public-signup'", row && row.source === 'public-signup', row && row.source);
  check('every profile field stored',
    row && row.phone === FULL.phone && row.addressStreet === FULL.street && row.addressCity === 'Boston'
    && row.addressState === 'MA' && row.addressZip === '02114' && row.website === FULL.website
    && row.heardAbout === FULL.heardAbout && row.notes === FULL.notes
    && row.contractorType === 'Data network introductions', row);
  check('the real website field did NOT trip the honeypot', !!row);
}
{
  check('office notification sent once', sentEmails.length === 1, sentEmails.length);
  const mail = sentEmails[0] || {};
  check('notification subject names the company',
    mail.subject === 'New partner sign-up — Ruiz Advisory Group LLC', mail.subject);
  check('notification goes to the office inbox',
    Array.isArray(mail.to) && mail.to.includes('info@iecincglobal.com'), mail.to);
  const body = `${mail.text || ''}\n${mail.html || ''}`;
  check('notification carries the FULL profile (type, phone, address, website, heard-about, notes)',
    body.includes('Data network introductions') && body.includes(FULL.phone) && body.includes('44 Canal Street') && body.includes('02114')
    && body.includes(FULL.website) && body.includes('Referred by a current IEC partner')
    && body.includes('dental practices'), body.slice(0, 200));
}

/* ================= admin serialization: the full record ================= */
console.log('admin serialization');
{
  const admin = await call('GET', 'admin-list', { cookie: deskCookie() });
  const row = (admin.payload.contractors || []).find(c => c.id === anaId);
  check('admin list returns the full sign-up record',
    row && row.source === 'public-signup' && row.phone === FULL.phone
    && row.addressStreet === FULL.street && row.addressCity === 'Boston' && row.addressState === 'MA'
    && row.addressZip === '02114' && row.website === FULL.website && row.heardAbout === FULL.heardAbout
    && row.notes === FULL.notes && row.status === 'invited' && !!row.createdAt
    && row.contractorType === 'Data network introductions', row);
}

/* ================= the gate does not move ================= */
console.log('sign-first gate on a self-registered partner');
{
  const me = await call('GET', 'me', { cookie: null });
  check('no session -> me returns 401 (a self-registered partner reads nothing)',
    me.statusCode === 401 && me.payload.error === 'unauthorized', me.payload);
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: anaId } });
  const token = new URL(inv.payload.activationUrl).searchParams.get('token');
  const blocked = await activate(token);
  check('activation before signatures -> 403 signing_required',
    blocked.statusCode === 403 && blocked.payload.error === 'signing_required', blocked.payload);
  await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: anaId, signed: true } });
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: anaId, signed: true } });
  const open = await activate(token);
  check('same link activates after both signatures (302)', open.statusCode === 302, { status: open.statusCode });
  check('partner becomes active', (await storeMod.readContractorById(anaId)).status === 'active');
}

/* ================= validation + duplicate + honeypot ================= */
console.log('validation');
{
  const dup = await call('POST', 'signup', { cookie: null, body: { ...FULL, email: 'ANA@RUIZADVISORY.TEST' } });
  check('duplicate email (any case) -> 409 already_registered with a neutral message',
    dup.statusCode === 409 && dup.payload.error === 'already_registered'
    && typeof dup.payload.message === 'string' && dup.payload.message.length > 0, dup.payload);
  const hp = await call('POST', 'signup', { cookie: null, body: { name: 'Bot', company: 'Bot Co', email: 'bot@spam.test', company_site_hp: 'http://spam.example' } });
  check('filled honeypot -> 400 rejected', hp.statusCode === 400 && hp.payload.error === 'rejected', hp.payload);
  check('honeypot submission stored NOTHING', (await storeMod.readContractorByEmail('bot@spam.test')) === null);
  const bad = await call('POST', 'signup', { cookie: null, body: { name: 'X', company: 'Y Co', email: 'not-an-email' } });
  check('bad email -> 400 invalid_fields', bad.statusCode === 400 && bad.payload.error === 'invalid_fields', bad.payload);
  const missing = await call('POST', 'signup', { cookie: null, body: { name: 'X', email: 'x@y.test', contractorType: 'Consulting' } });
  check('missing company -> 400 invalid_fields', missing.statusCode === 400 && missing.payload.error === 'invalid_fields', missing.payload);
  const noType = await call('POST', 'signup', { cookie: null, body: { name: 'X', company: 'Y Co', email: 'x2@y.test' } });
  check('missing contractor type -> 400 invalid_fields', noType.statusCode === 400 && noType.payload.error === 'invalid_fields', noType.payload);
  const badType = await call('POST', 'signup', { cookie: null, body: { name: 'X', company: 'Y Co', email: 'x3@y.test', contractorType: 'Wizardry' } });
  check('unknown contractor type -> 400 invalid_fields, nothing stored',
    badType.statusCode === 400 && badType.payload.error === 'invalid_fields'
    && (await storeMod.readContractorByEmail('x3@y.test')) === null, badType.payload);
}

/* ================= malformed payloads: clean 400s, no internals ================= */
console.log('malformed payloads');
{
  for (const [label, raw] of [['null body', 'null'], ['array body', '[1,2,3]'], ['broken JSON', '{not json'], ['scalar body', '42']]) {
    const r = await call('POST', 'signup', { cookie: null, body: raw });
    check(`${label} -> 400 invalid_fields, no stack or internals`,
      r.statusCode === 400 && r.payload.error === 'invalid_fields'
      && !JSON.stringify(r.payload).match(/Error|at\s+\w+\s+\(|node:|api\//), r.payload);
  }
  const big = await call('POST', 'signup', { cookie: null, body: { name: 'N'.repeat(5000), company: 'Big Co', email: 'big@bigco.test', contractorType: 'Other', notes: 'x'.repeat(20000) } });
  const brow = await storeMod.readContractorByEmail('big@bigco.test');
  check('oversized fields are accepted but stored truncated to the caps',
    big.statusCode === 200 && brow && brow.name.length === 120 && brow.notes.length === 2000,
    brow && { name: brow.name.length, notes: brow.notes.length });
  check('no notification fired for any rejected payload (still exactly 2: Ana + Big Co)',
    sentEmails.length === 2, sentEmails.length);
}

/* ================= optional fields may stay empty ================= */
console.log('minimal sign-up');
{
  const r = await call('POST', 'signup', { cookie: null, body: { name: 'Lee Park', company: 'Park Ventures', email: 'lee@parkventures.test', contractorType: 'Consulting' } });
  check('required-only signup succeeds', r.statusCode === 200 && r.payload.ok === true, r.payload);
  const row = await storeMod.readContractorByEmail('lee@parkventures.test');
  check('optional fields stored empty, type stored, source still public-signup',
    row && row.phone === '' && row.addressStreet === '' && row.website === '' && row.notes === ''
    && row.contractorType === 'Consulting'
    && row.source === 'public-signup' && row.status === 'invited', row);
}

/* ================= mailer failure never blocks the record ================= */
console.log('mailer failure');
{
  resendMode = 'fail';
  const r = await call('POST', 'signup', { cookie: null, body: { name: 'Marta Diaz', company: 'Diaz Group', email: 'marta@diazgroup.test', contractorType: 'Other', phone: '305-555-0119' } });
  check('mailer down -> signup still 200 ok, emailed:false reported honestly',
    r.statusCode === 200 && r.payload.ok === true && r.payload.emailed === false, r.payload);
  const row = await storeMod.readContractorByEmail('marta@diazgroup.test');
  check('record stored despite the mail failure', row && row.company === 'Diaz Group' && row.phone === '305-555-0119', row);
  resendMode = 'ok';
}

console.log(failures === 0 ? `\nALL GREEN — 0 failures` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
