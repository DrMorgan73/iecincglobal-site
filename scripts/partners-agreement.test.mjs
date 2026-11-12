/* Partner Portal AGREEMENT suite: the in-portal acceptance of
   the IEC Contractor Referral Agreement (DataSupply-style — the
   full text inside the portal, typed legal name + accept action
   as the signature of record).

   Covers: an unsigned partner opening the activation link is
   routed to the agreement page and cannot activate; the agreement
   endpoint serves the verbatim text (Articles 1–18 + Exhibit A)
   only to the link holder; empty/mismatched typed names -> 400;
   a valid acceptance flips agreement_status and stores {typed
   name, timestamp, version id, via 'portal'}; a second acceptance
   is a no-op (alreadySigned); the gate still refuses activation
   while the NDA is unsigned after agreement acceptance; the
   office-marked (paper) path is never re-asked and reports no
   portal acceptance; admin-list carries the acceptance fields;
   the generated content module round-trips to the agreement text.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables). No real database, no network.
   Run: node scripts/partners-agreement.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-agreement-secret';
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
const contentMod = await import('../api/_agreement-content.js');

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

/* ================= the generated text is the agreement ================= */
console.log('agreement content module');
{
  const t = contentMod.AGREEMENT_TEXT;
  const arts = ['1. Definitions', '2. Appointment and Relationship', '3. Free to Join', '4. Referrals and Registration',
    '5. Compensation', '6. Payment Terms', '7. No Network; No Sponsorship', '8. Good Standing',
    '9. Conduct and Compliance', '10. Confidentiality and Non-Circumvention', '11. Brand and Materials',
    '12. Term and Termination', '13. Program Policies and Changes', '14. Earnings Disclaimer',
    '15. Communications and Data', '16. Resolving Disputes', '17. Liability and General Terms',
    '18. Signatures', 'EXHIBIT A'];
  check('content carries all 18 articles + Exhibit A', arts.every(a => t.includes(a)), arts.filter(a => !t.includes(a)));
  check('content carries the adopted fee figures', ['$10,800', '$50,000', '$700,000', '$10,000,000'].every(n => t.includes(n)));
  const stripped = contentMod.AGREEMENT_HTML
    .replace(/<\/?(?:h1|h2|h3|p|ul|li|table|thead|tbody|tr|th|td|hr)\b[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const norm = s => s.replace(/\s+/g, ' ').trim();
  check('HTML render round-trips to the agreement text (verbatim)', norm(stripped) === norm(t));
  check('version id is the instrument version (+content stamp when built)',
    /^IEC-CRA-2026-11-12(\+[0-9a-f]{7})?$/.test(contentMod.agreementVersionId()), contentMod.agreementVersionId());
  const banned = ['client fee', "IEC's share", 'IEC share', "IEC's fees", 'Seller Fee', 'Origination Fee', '2.0%', '1.0%', '0.5%'];
  check('no scrubbed IEC-fee phrasing in the served text', banned.every(b => !t.includes(b)), banned.filter(b => t.includes(b)));
}

/* ================= partner arrives unsigned ================= */
console.log('routing');
let lenaId = null;
let token = null;
{
  await call('POST', 'register', { cookie: null, body: { name: 'Lena Ortiz', email: 'lena@example.test', company: 'Ortiz Advisory LLC' } });
  lenaId = (await storeMod.readContractorByEmail('lena@example.test')).id;
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: lenaId } });
  token = new URL(inv.payload.activationUrl).searchParams.get('token');
  const res = await rawActivate(token);
  check('unsigned partner opening the link is routed to the agreement page',
    res.statusCode === 302 && String(res.headers.Location || '').startsWith('/contractors-agreement.html?t='), res.headers);
  check('no session is issued at the agreement step', !res.headers['Set-Cookie'], res.headers);
  check('partner is still invited (link not consumed, not activated)',
    (await storeMod.readContractorById(lenaId)).status === 'invited');
}

/* ================= the agreement endpoint ================= */
console.log('agreement endpoint');
{
  const bad = await call('GET', 'agreement', { cookie: null, query: 'token=deadbeef.9999999999.deadbeef' });
  check('agreement with a bogus token -> 401 (text is never public)', bad.statusCode === 401, bad.payload);
  const none = await call('GET', 'agreement', { cookie: null });
  check('agreement with no token -> 401', none.statusCode === 401, none.payload);
  const g = await call('GET', 'agreement', { cookie: null, query: `token=${encodeURIComponent(token)}` });
  check('agreement for the link holder -> 200 with identity + version',
    g.statusCode === 200 && g.payload.ok && g.payload.contractor.name === 'Lena Ortiz'
    && g.payload.contractor.company === 'Ortiz Advisory LLC'
    && g.payload.version === contentMod.agreementVersionId(), g.payload && g.payload.version);
  check('served state: agreement pending, NDA pending, no acceptance yet',
    g.payload.agreementStatus === 'pending' && g.payload.ndaStatus === 'pending' && g.payload.acceptance === null, g.payload);
  check('served HTML carries Article 5 + Exhibit A figures',
    g.payload.html.includes('5. Compensation') && g.payload.html.includes('$700,000') && g.payload.html.includes('EXHIBIT A'));
}

/* ================= acceptance validation ================= */
console.log('acceptance validation');
{
  const empty = await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: '  ', accept: true } });
  check('empty typed name -> 400', empty.statusCode === 400 && empty.payload.error === 'invalid_fields', empty.payload);
  const noBox = await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: 'Lena Ortiz' } });
  check('accept flag missing -> 400', noBox.statusCode === 400 && noBox.payload.error === 'invalid_fields', noBox.payload);
  const wrong = await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: 'Lena Ortiz-Smith', accept: true } });
  check('mismatched typed name -> 400 name_mismatch', wrong.statusCode === 400 && wrong.payload.error === 'name_mismatch', wrong.payload);
  const other = await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: 'Someone Else', accept: true } });
  check("another person's name -> 400 name_mismatch", other.statusCode === 400 && other.payload.error === 'name_mismatch', other.payload);
  check('failed attempts record NOTHING (agreement still pending)',
    (await storeMod.readContractorById(lenaId)).agreementStatus === 'pending');
}

/* ================= a valid acceptance is the signature of record ================= */
console.log('acceptance');
let acceptedVersion = null;
{
  const r = await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: 'Lena Ortiz', accept: true } });
  check('valid acceptance -> 200, agreement signed, next step is the NDA',
    r.statusCode === 200 && r.payload.ok && r.payload.agreementStatus === 'signed' && r.payload.next === 'nda', r.payload);
  acceptedVersion = r.payload.version;
  const row = await storeMod.readContractorById(lenaId);
  check('acceptance stored: typed name + version + via portal + timestamp',
    row.agreementStatus === 'signed' && row.agreementAcceptedName === 'Lena Ortiz'
    && row.agreementAcceptedVersion === acceptedVersion && row.agreementAcceptedVia === 'portal'
    && !!row.agreementSignedAt, row);
  const again = await call('POST', 'accept-agreement', { cookie: null, body: { token, typedName: 'Lena Ortiz', accept: true } });
  check('a second acceptance is a no-op (alreadySigned, record untouched)',
    again.statusCode === 200 && again.payload.alreadySigned === true
    && again.payload.acceptance && again.payload.acceptance.name === 'Lena Ortiz'
    && again.payload.acceptance.version === acceptedVersion, again.payload);
}

/* ================= the gate still holds until the NDA ================= */
console.log('gate after acceptance');
{
  const res = await rawActivate(token);
  check('activation still refused while the NDA is unsigned (routed back, no session)',
    res.statusCode === 302 && String(res.headers.Location || '').startsWith('/contractors-agreement.html?t=')
    && !res.headers['Set-Cookie'], res.headers);
  check('partner still invited after the refused activation',
    (await storeMod.readContractorById(lenaId)).status === 'invited');
  const admin = await call('GET', 'admin-list', { cookie: deskCookie() });
  const row = (admin.payload.contractors || []).find(c => c.id === lenaId);
  check('Desk record shows the in-portal acceptance (name, version, via)',
    row && row.agreementAcceptedVia === 'portal' && row.agreementAcceptedName === 'Lena Ortiz'
    && row.agreementAcceptedVersion === acceptedVersion && row.agreementStatus === 'signed', row);
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: lenaId, signed: true } });
  const open = await rawActivate(token);
  check('once the NDA stands, the same link activates (302 portal + session)',
    open.statusCode === 302 && open.headers.Location === '/contractors-portal.html'
    && String(open.headers['Set-Cookie'] || '').startsWith('contractor_session='), open.headers);
  check('partner is active', (await storeMod.readContractorById(lenaId)).status === 'active');
  const gone = await call('GET', 'agreement', { cookie: null, query: `token=${encodeURIComponent(token)}` });
  check('the consumed link no longer opens the agreement step (401)', gone.statusCode === 401, gone.payload);
}

/* ================= the office-marked path is never re-asked ================= */
console.log('office-marked partner');
{
  await call('POST', 'register', { cookie: null, body: { name: 'Omar Farouk', email: 'omar@example.test', company: 'Omar Advisory' } });
  const omarId = (await storeMod.readContractorByEmail('omar@example.test')).id;
  await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: omarId, signed: true } });
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: omarId } });
  const otoken = new URL(inv.payload.activationUrl).searchParams.get('token');
  const g = await call('GET', 'agreement', { cookie: null, query: `token=${encodeURIComponent(otoken)}` });
  check('office-signed partner: agreement reads signed with NO portal acceptance',
    g.statusCode === 200 && g.payload.agreementStatus === 'signed' && g.payload.acceptance === null, g.payload);
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: omarId, signed: true } });
  const open = await rawActivate(otoken);
  check('office-signed partner activates straight to the portal (never blocked or re-asked)',
    open.statusCode === 302 && open.headers.Location === '/contractors-portal.html', open.headers);
}

console.log(failures === 0 ? `\nALL GREEN — 0 failures` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
