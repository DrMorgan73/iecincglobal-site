/* Partner Portal SIGNATURE-ISOLATION suite (regression for the
   2026-11-12 live-audit finding): in the Desk Partners admin, one
   "Mark NDA signed" click on one partner record appeared to flip a
   SECOND record that carried the same person name.

   The code audit found every layer already keyed by the record's
   UUID (admin button -> contractorId -> readContractorById ->
   UPDATE ... WHERE id = $N, id PRIMARY KEY). This suite LOCKS
   that invariant so it can never regress:

     - two partner records with the SAME name, different emails;
     - office set-nda on record A -> A signed, B untouched, and
       the captured SQL shows exactly ONE contractors UPDATE whose
       WHERE parameter is A's id (never a name, never B's id);
     - office set-agreement on record B -> B signed, A untouched,
       same single-row SQL evidence;
     - each response identifies the ONE record marked (id + email);
     - a repeat mark is refused (409) and changes nothing;
     - an unknown contractorId -> 404;
     - admin-list reports the two records' states independently.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables) with a statement log. No real database, no network.
   Run: node scripts/partners-signature-isolation.test.mjs
   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-isolation-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'postgres://u:p@neon-sql.test/db';

/* ---------------- mocked Neon SQL endpoint ---------------- */
const TABLES = { contractors: new Map(), contractor_referrals: new Map(), client_claims: new Map() };
const SQL_LOG = [];

function neonSql(query, params) {
  const q = query.replace(/\s+/g, ' ').trim();
  SQL_LOG.push({ q, params: [...(params || [])] });
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

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

/* Updates issued against the contractors table since a mark. */
function contractorUpdatesSince(mark) {
  return SQL_LOG.slice(mark).filter(e => /^UPDATE contractors SET/.test(e.q));
}

/* ================= two records, ONE shared name ================= */
console.log('setup — two partner records with the same name');
let idA = null; let idB = null;
{
  await call('POST', 'register', { cookie: null, body: { name: 'Mohammed Morgan', email: 'alpha@example.test', company: 'IEC, Inc.' } });
  await call('POST', 'register', { cookie: null, body: { name: 'Mohammed Morgan', email: 'beta@example.test', company: 'IEC, Inc.' } });
  const a = await storeMod.readContractorByEmail('alpha@example.test');
  const b = await storeMod.readContractorByEmail('beta@example.test');
  idA = a.id; idB = b.id;
  check('two distinct records exist for the same name', !!idA && !!idB && idA !== idB, { idA, idB });
  check('both start with NDA + agreement pending',
    a.ndaStatus === 'pending' && a.agreementStatus === 'pending'
    && b.ndaStatus === 'pending' && b.agreementStatus === 'pending');
}

/* ================= mark the NDA on record A only ================= */
console.log('set-nda isolation');
{
  const mark = SQL_LOG.length;
  const res = await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: idA, signed: true } });
  check('set-nda on A -> 200 ok', res.statusCode === 200 && res.payload.ok === true, res.payload);
  check('response identifies the ONE record marked (id + email + name)',
    res.payload.contractorId === idA && res.payload.email === 'alpha@example.test'
    && res.payload.name === 'Mohammed Morgan', res.payload);
  const ups = contractorUpdatesSince(mark);
  check('exactly ONE contractors UPDATE was issued for the mark', ups.length === 1, ups.map(u => u.q));
  if (ups.length === 1) {
    const u = ups[0];
    check('the UPDATE sets nda_status and its WHERE parameter is A\'s id — not the shared name, not B\'s id',
      /nda_status/.test(u.q) && u.params[u.params.length - 1] === idA
      && !u.params.includes(idB) && !u.params.includes('Mohammed Morgan'), u.params);
  }
  const a = await storeMod.readContractorById(idA);
  const b = await storeMod.readContractorById(idB);
  check('A: NDA signed', a.ndaStatus === 'signed', a.ndaStatus);
  check('B: completely untouched (NDA pending, agreement pending, still invited)',
    b.ndaStatus === 'pending' && b.agreementStatus === 'pending' && b.status === 'invited',
    { nda: b.ndaStatus, agr: b.agreementStatus, status: b.status });
}

/* ================= mark the agreement on record B only ================= */
console.log('set-agreement isolation');
{
  const mark = SQL_LOG.length;
  const res = await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: idB, signed: true } });
  check('set-agreement on B -> 200 ok', res.statusCode === 200 && res.payload.ok === true, res.payload);
  check('response identifies the ONE record marked (id + email)',
    res.payload.contractorId === idB && res.payload.email === 'beta@example.test', res.payload);
  const ups = contractorUpdatesSince(mark);
  check('exactly ONE contractors UPDATE was issued for the mark', ups.length === 1, ups.map(u => u.q));
  if (ups.length === 1) {
    const u = ups[0];
    check('the UPDATE sets agreement_status and its WHERE parameter is B\'s id only',
      /agreement_status/.test(u.q) && u.params[u.params.length - 1] === idB
      && !u.params.includes(idA) && !u.params.includes('Mohammed Morgan'), u.params);
  }
  const a = await storeMod.readContractorById(idA);
  const b = await storeMod.readContractorById(idB);
  check('B: agreement signed, NDA still pending (marks are independent)',
    b.agreementStatus === 'signed' && b.ndaStatus === 'pending', { agr: b.agreementStatus, nda: b.ndaStatus });
  check('A: agreement still pending (B\'s mark did not leak), NDA still signed from its own mark',
    a.agreementStatus === 'pending' && a.ndaStatus === 'signed', { agr: a.agreementStatus, nda: a.ndaStatus });
}

/* ================= guards: repeat mark + unknown id ================= */
console.log('guards');
{
  const again = await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: idA, signed: true } });
  check('repeat set-nda on A -> 409 invalid_transition, nothing changes',
    again.statusCode === 409 && again.payload.error === 'invalid_transition', again.payload);
  const ghost = await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: 'no-such-record-id', signed: true } });
  check('set-nda with an unknown contractorId -> 404', ghost.statusCode === 404, ghost.payload);
  const ghostAgr = await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: 'no-such-record-id', signed: true } });
  check('set-agreement with an unknown contractorId -> 404', ghostAgr.statusCode === 404, ghostAgr.payload);
  const b = await storeMod.readContractorById(idB);
  check('B still untouched after the guard probes', b.ndaStatus === 'pending' && b.agreementStatus === 'signed', { nda: b.ndaStatus, agr: b.agreementStatus });
}

/* ================= admin-list reports the records independently ================= */
console.log('admin-list');
{
  const res = await call('GET', 'admin-list', { cookie: deskCookie() });
  const list = (res.payload && res.payload.contractors) || [];
  const la = list.find(c => c.id === idA);
  const lb = list.find(c => c.id === idB);
  check('admin-list: A shows NDA signed / agreement pending',
    !!la && la.ndaStatus === 'signed' && la.agreementStatus === 'pending', la && { nda: la.ndaStatus, agr: la.agreementStatus });
  check('admin-list: B shows NDA pending / agreement signed',
    !!lb && lb.ndaStatus === 'pending' && lb.agreementStatus === 'signed', lb && { nda: lb.ndaStatus, agr: lb.agreementStatus });
}

console.log(failures === 0 ? '\nALL GREEN — 0 failures' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
