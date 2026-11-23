/* Local test suite — Partner Portal sign-in chain + forgot-link
   recovery (Nov 23, 2026): api/contractors.js against the mocked
   Neon store (in-memory tables) and a mocked Resend endpoint
   that captures outgoing mail. Covers the whole entrance chain
   at handler level: office invite -> sign-in (code) -> dashboard
   data (the partner's own log only) -> single-use consumption ->
   recovery issues a FRESH link that supersedes the outstanding
   one -> unknown / ineligible emails get the identical generic
   answer and no mail.

   Run: node scripts/partner-portal-recovery.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-contractor-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'postgres://test:test@neon-sql.test/neondb';

/* ---------------- mocked Neon SQL endpoint ---------------- */
const TABLES = { contractors: new Map(), contractor_referrals: new Map(), client_claims: new Map() };
let neonMode = 'ok';

function neonSql(query, params) {
  const q = query.replace(/\s+/g, ' ').trim();
  if (/^CREATE TABLE IF NOT EXISTS/.test(q)) return { rows: [] };
  if (/^ALTER TABLE/.test(q)) return { rows: [] };
  if (/^DELETE FROM/.test(q)) return { rows: [] };
  let m = q.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/);
  if (m) {
    const [, table, colsRaw, valsRaw] = m;
    const cols = colsRaw.split(',').map(s => s.trim());
    const vals = valsRaw.split(',').map(s => s.trim());
    const row = {};
    // Positional mapping honours BOTH $N params and SQL literals
    // ('invited', 'pending', 'registered') — the real Neon applies
    // the literals; the mock must too.
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
      // Supported: `col = $N`, `col = $N OR col = $N`, `col IN (...)`
      const ors = where.split(' OR ').map(s => s.trim());
      rows = rows.filter(r => ors.some(cond => {
        const cm = cond.match(/^(\w+) = \$(\d+)$/);
        if (cm) return String(r[cm[1]]) === String(params[Number(cm[2]) - 1]);
        const im = cond.match(/^(\w+) IN \(([^)]+)\)$/);
        if (im) {
          const vals = im[2].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
          return vals.includes(String(r[im[1]]));
        }
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
const sentMail = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    if (neonMode === 'throw') throw new Error('network down');
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  if (u === 'https://api.resend.com/emails') {
    sentMail.push(JSON.parse(opts.body));
    return jsonRes(200, { id: 'email-' + sentMail.length });
  }
  throw new Error(`unmocked fetch: ${u}`);
};

process.env.DEMO_ADMIN_RESEND_API_KEY = 'test-resend-key';

/* ---------------- modules under test ---------------- */
const mod = await import('../api/contractors.js');
const handler = mod.default;
const feesMod = await import('../api/_contractors-fees.js');
const authMod = await import('../api/_contractors-auth.js');
const storeMod = await import('../api/_contractors-store.js');

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
function contractorCookie(id, exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('hex');
  return `contractor_session=${id}.${exp}.${sig}`;
}
async function call(method, action, { body, cookie } = {}) {
  const url = '/api/contractors' + (action ? `?action=${action}` : '');
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


/* ================= setup: two throwaway partners ================= */
console.log('sign-in chain + forgot-link recovery');
const GENERIC = 'If that email matches an active partner record, a new sign-in link is on its way.';
let aId = null, bId = null;
{
  const rA = await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Aaa', email: 'partner-a@example.test', company: 'Aaa Ventures LLC' } });
  const rB = await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Bbb', email: 'partner-b@example.test', company: 'Bbb Holdings LLC' } });
  check('throwaway partners A + B register', rA.payload.ok === true && rB.payload.ok === true);
  aId = (await storeMod.readContractorByEmail('partner-a@example.test')).id;
  bId = (await storeMod.readContractorByEmail('partner-b@example.test')).id;
  /* The office records both signatures for both partners, and
     both stand active while they use the portal (an invited
     record holds no session — the portal opens on activation). */
  await storeMod.updateContractor(aId, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed' });
  await storeMod.updateContractor(bId, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed' });
  /* Each partner registers one client of his own. */
  const cA = await call('POST', 'register-referral', {
    cookie: contractorCookie(aId),
    body: { businessName: 'Aaa Client Corp', ownerName: 'Ann Aaa', ownerEmail: 'ann@aaaclient.test', industry: 'home-health', deskStaffBand: '20-34' }
  });
  const cB = await call('POST', 'register-referral', {
    cookie: contractorCookie(bId),
    body: { businessName: 'Bbb Client Corp', ownerName: 'Bob Bbb', ownerEmail: 'bob@bbbclient.test', industry: 'pharmacy', deskStaffBand: '20-34' }
  });
  check('each partner registers his own client', cA.statusCode === 200 && cB.statusCode === 200, { cA: cA.payload, cB: cB.payload });
  /* B returns to invited-with-both-signatures for the recovery
     eligibility checks below (fully registered, first portal
     activation not yet completed). */
  await storeMod.updateContractor(bId, { status: 'invited' });
}

/* ================= the chain: invite -> sign-in -> dashboard ================= */
let tokenA1 = null, sessionA = null;
{
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: aId } });
  check('office invite mints A an activation link', inv.statusCode === 200 && !!inv.payload.activationUrl, inv.payload);
  tokenA1 = new URL(inv.payload.activationUrl).searchParams.get('token');
}
{
  const r = await call('POST', 'signin', { cookie: null, body: { credential: tokenA1 } });
  check('sign-in with the code -> next:dashboard + session cookie',
    r.statusCode === 200 && r.payload.ok === true && r.payload.next === 'dashboard'
    && String(r.headers['Set-Cookie'] || '').startsWith('contractor_session='), r.payload);
  sessionA = String(r.headers['Set-Cookie'] || '').split(';')[0];
}
{
  const me = await call('GET', 'me', { cookie: sessionA });
  check('dashboard data is A\'s own log: A\'s client present, B\'s client absent',
    me.statusCode === 200 && me.payload.contractor && me.payload.contractor.id === aId
    && (me.payload.clients || []).length === 1 && me.payload.clients[0].businessName === 'Aaa Client Corp'
    && JSON.stringify(me.payload).includes('Bbb Client Corp') === false, me.payload);
}
{
  const r = await call('POST', 'signin', { cookie: null, body: { credential: tokenA1 } });
  check('the same code a second time -> 401 (single-use)', r.statusCode === 401 && r.payload.ok === false, r.payload);
}

/* ================= recovery: fresh link supersedes ================= */
let tokenA2 = null, tokenA3 = null;
{
  /* Activation tokens carry a whole-second expiry, so two links
     minted inside the same second are the same link. The waits
     keep the three links in this suite distinct, as they are in
     real use (minutes apart). */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1100);
  const inv2 = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: aId } });
  tokenA2 = new URL(inv2.payload.activationUrl).searchParams.get('token');
  await sleep(1100);
  const before = sentMail.length;
  const r = await call('POST', 'recover', { cookie: null, body: { email: 'partner-a@example.test' } });
  check('recover (active partner) -> 200 generic ok', r.statusCode === 200 && r.payload.ok === true && r.payload.message === GENERIC, r.payload);
  check('recover emailed A exactly one message', sentMail.length === before + 1 && sentMail[sentMail.length - 1].to[0] === 'partner-a@example.test');
  const mail = sentMail[sentMail.length - 1];
  check('recovery mail: from info@, recovery subject, IEC signature, no cc',
    /info@iecincglobal\.com/.test(mail.from) && mail.subject === 'Your new IEC Partner Portal sign-in link'
    && /Mohammed Morgan, MD/.test(mail.text) && !mail.cc && !mail.bcc, { from: mail.from, subject: mail.subject });
  const m = String(mail.text).match(/token=([^\s]+)/);
  tokenA3 = m ? decodeURIComponent(m[1]) : null;
  check('recovery mail carries a FRESH token (not the outstanding one)', !!tokenA3 && tokenA3 !== tokenA2);
}
{
  const old = await call('POST', 'signin', { cookie: null, body: { credential: tokenA2 } });
  check('the superseded link no longer signs in -> 401', old.statusCode === 401 && old.payload.ok === false, old.payload);
  const pasted = 'https://partners.iecincglobal.com/signin?t=' + encodeURIComponent(tokenA3);
  const r = await call('POST', 'signin', { cookie: null, body: { credential: pasted } });
  check('the recovery link (pasted whole) signs in -> dashboard',
    r.statusCode === 200 && r.payload.ok === true && r.payload.next === 'dashboard', r.payload);
}

/* ================= recovery: no enumeration, no mail otherwise ================= */
{
  const before = sentMail.length;
  const r = await call('POST', 'recover', { cookie: null, body: { email: 'nobody@example.test' } });
  check('recover (unknown email) -> identical generic response, no email',
    r.statusCode === 200 && r.payload.ok === true && r.payload.message === GENERIC && sentMail.length === before, r.payload);
}
{
  const before = sentMail.length;
  const r = await call('POST', 'recover', { cookie: null, body: { email: 'partner-b@example.test' } });
  check('recover (invited, both signatures stand) -> generic ok + fresh link emailed',
    r.statusCode === 200 && r.payload.message === GENERIC && sentMail.length === before + 1);
  await storeMod.updateContractor(bId, { status: 'revoked' });
  const before2 = sentMail.length;
  const r2 = await call('POST', 'recover', { cookie: null, body: { email: 'partner-b@example.test' } });
  check('recover (revoked partner) -> generic ok, no email',
    r2.statusCode === 200 && r2.payload.message === GENERIC && sentMail.length === before2, r2.payload);
}
{
  await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Ccc', email: 'partner-c@example.test', company: 'Ccc LLC' } });
  const before = sentMail.length;
  const r = await call('POST', 'recover', { cookie: null, body: { email: 'partner-c@example.test' } });
  check('recover (signatures outstanding) -> generic ok, no email',
    r.statusCode === 200 && r.payload.message === GENERIC && sentMail.length === before, r.payload);
}
{
  const r = await call('POST', 'recover', { cookie: null, body: { email: 'not-an-email' } });
  check('recover (malformed email) -> still the generic 200, no email',
    r.statusCode === 200 && r.payload.ok === true && r.payload.message === GENERIC, r.payload);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
