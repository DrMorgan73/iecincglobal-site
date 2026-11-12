/* Local test suite for the IEC Contractor Portal:
   api/contractors.js + api/_contractors-store.js +
   api/_contractors-fees.js + api/_contractors-auth.js.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables). No real database, no network, no Blob store.
   Desk sessions and contractor tokens are minted exactly the way
   the production code verifies them (the test owns both secrets).

   Run: node scripts/contractors.test.mjs   (exit 1 on failure) */

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
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    if (neonMode === 'throw') throw new Error('network down');
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  throw new Error(`unmocked fetch: ${u}`);
};

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

/* ================= fee math ================= */
console.log('fee schedule');
check('fee $100,000 -> $2,000', feesMod.referralFee(100000) === 2000);
check('fee $250,000 -> $5,000', feesMod.referralFee(250000) === 5000);
check('fee $500,000 -> $7,500', feesMod.referralFee(500000) === 7500);
check('fee $1,000,000 -> $12,500', feesMod.referralFee(1000000) === 12500);
check('fee $2,000,000 -> $17,500', feesMod.referralFee(2000000) === 17500);
check('fee $5,000,000 -> $25,000 (capped)', feesMod.referralFee(5000000) === 25000);
check('fee $14,500,000 -> $25,000 (capped)', feesMod.referralFee(14500000) === 25000);
check('fee 0 / negative / NaN -> 0', feesMod.referralFee(0) === 0 && feesMod.referralFee(-5) === 0 && feesMod.referralFee(NaN) === 0);
check('schedule is DRAFT with open rulings', feesMod.FEE_SCHEDULE.status === 'DRAFT' && feesMod.FEE_SCHEDULE.openRulings.length === 2);
check('examples are computed, 7 rows, $250K row $5,000',
  feesMod.feeExamples().length === 7 && feesMod.feeExamples()[1].fee === 5000);

/* ================= auth ================= */
console.log('contractor tokens');
const tok = authMod.mintActivationToken('ctr-test-1');
check('activation token verifies to the id', authMod.verifyToken(tok) === 'ctr-test-1');
check('tampered token fails', authMod.verifyToken(tok.slice(0, -2) + 'zz') === null);
check('expired token fails', authMod.verifyToken(authMod.mintToken('ctr-test-1', -10)) === null);
check('hash is stable and never equals the token',
  authMod.hashToken(tok) === authMod.hashToken(tok) && authMod.hashToken(tok) !== tok);

/* ================= public schedule ================= */
console.log('public schedule endpoint');
{
  const r = await call('GET', 'schedule', { cookie: null });
  check('schedule returns 200 + DRAFT + cap 25000',
    r.statusCode === 200 && r.payload.ok && r.payload.schedule.status === 'DRAFT' && r.payload.schedule.cap === 25000);
  check('schedule names no channel', JSON.stringify(r.payload).toLowerCase().includes('datasupply') === false
    && JSON.stringify(r.payload).toLowerCase().includes('janise') === false);
}

/* ================= registration + activation ================= */
console.log('registration and activation');
const ctrEmail = 'surendra@example.test';
let ctrId = null;
{
  const r = await call('POST', 'register', { cookie: null, body: { name: 'Surendra Vaidya', email: ctrEmail, company: 'Omshivam-Boston LLC' } });
  check('register returns ok + next /cnda.html', r.statusCode === 200 && r.payload.ok && r.payload.next === '/cnda.html', r.payload);
  const row = await storeMod.readContractorByEmail(ctrEmail);
  ctrId = row && row.id;
  check('contractor stored invited + NDA pending', row && row.status === 'invited' && row.ndaStatus === 'pending', row);
}
{
  const r = await call('POST', 'register', { cookie: null, body: { name: 'Someone Else', email: ctrEmail, company: 'Other LLC' } });
  check('duplicate email registration returns existing:true, no new row',
    r.statusCode === 200 && r.payload.ok && r.payload.existing === true, r.payload);
}
{
  const r = await call('POST', 'register', { cookie: null, body: { name: '', email: 'not-an-email', company: 'X' } });
  check('invalid registration fields -> 400', r.statusCode === 400 && r.payload.error === 'invalid_fields');
}
let activationToken = null;
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
{
  // Admin invite mints the activation link.
  const r = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: ctrId } });
  check('admin invite returns an activation URL', r.statusCode === 200 && r.payload.ok && String(r.payload.activationUrl).includes('action=activate&token='), r.payload);
  activationToken = new URL(r.payload.activationUrl).searchParams.get('token');
  // Sign-first: activation is blocked until BOTH the agreement and
  // the NDA are recorded signed — and a blocked attempt does not
  // consume the link.
  const blocked = await rawActivate(activationToken);
  check('activation before any signature -> 403 signing_required, link not consumed',
    blocked.statusCode === 403 && blocked.payload.error === 'signing_required', blocked.payload);
  const ag = await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: ctrId, signed: true } });
  check('admin set-agreement -> signed', ag.statusCode === 200 && ag.payload.agreementStatus === 'signed', ag.payload);
  const blocked2 = await rawActivate(activationToken);
  check('activation with agreement only (NDA pending) -> still 403',
    blocked2.statusCode === 403 && blocked2.payload.error === 'signing_required', blocked2.payload);
  // Successful activation is exercised after the NDA is signed in
  // the portal block below (same token — it was never consumed).
}

/* ================= me + NDA gate + referrals ================= */
console.log('portal, NDA gate, referrals');
// The activation-link flow is covered separately below; here the
// contractor is placed in 'active' directly (an already-activated
// partner whose NDA is still pending) so the NDA gate is what the
// next checks exercise.
await storeMod.updateContractor(ctrId, { status: 'active' });
const ck = () => contractorCookie(ctrId);
{
  const r = await call('GET', 'me', { cookie: ck() });
  check('me returns the contractor + empty referrals + schedule',
    r.statusCode === 200 && r.payload.ok && r.payload.contractor.email === ctrEmail
    && Array.isArray(r.payload.referrals) && r.payload.referrals.length === 0
    && r.payload.schedule.cap === 25000, r.payload);
}
{
  const r = await call('GET', 'me', { cookie: null });
  check('me without a session -> 401', r.statusCode === 401);
}
{
  // Referral registration is gated on the NDA being signed.
  const r = await call('POST', 'register-referral', {
    cookie: ck(),
    body: { businessName: 'Acme Health LLC', ownerName: 'Ana Owner', ownerEmail: 'ana@acme.test', industry: 'home-health' }
  });
  check('referral before NDA signed -> 403 nda_required', r.statusCode === 403 && r.payload.error === 'nda_required', r.payload);
}
{
  // Admin marks the NDA signed; then registration opens.
  const s = await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: ctrId, signed: true } });
  check('admin set-nda -> signed', s.statusCode === 200 && s.payload.ndaStatus === 'signed', s.payload);
  const s2 = await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: ctrId, signed: true } });
  check('set-nda twice -> 409 (forward-only)', s2.statusCode === 409);
}
let refId = null;
{
  const r = await call('POST', 'register-referral', {
    cookie: ck(),
    body: { businessName: 'Acme Health LLC', ownerName: 'Ana Owner', ownerEmail: 'ana@acme.test', industry: 'home-health' }
  });
  check('referral registers after NDA signed', r.statusCode === 200 && r.payload.ok && r.payload.status === 'registered', r.payload);
  refId = r.payload.referralId;
}
{
  // First-to-register: same business, different contractor -> refused, no leak.
  const r2 = await call('POST', 'register', { cookie: null, body: { name: 'Second Contractor', email: 'second@example.test', company: 'Second LLC' } });
  check('second contractor registers', r2.statusCode === 200 && r2.payload.ok);
  const row2 = await storeMod.readContractorByEmail('second@example.test');
  await storeMod.updateContractor(row2.id, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed' });
  const dup = await call('POST', 'register-referral', {
    cookie: contractorCookie(row2.id),
    body: { businessName: 'ACME HEALTH, LLC', ownerName: 'Someone Else', ownerEmail: 'other@acme.test', industry: 'home-health' }
  });
  check('duplicate business (normalised) -> 409 already_registered, no other contractor named',
    dup.statusCode === 409 && dup.payload.error === 'already_registered'
    && JSON.stringify(dup.payload).includes('Acme') === false, dup.payload);
  const dup2 = await call('POST', 'register-referral', {
    cookie: contractorCookie(row2.id),
    body: { businessName: 'Different Business LLC', ownerName: 'Ana Owner', ownerEmail: 'ana@acme.test', industry: 'pharmacy' }
  });
  check('duplicate owner email -> 409 already_registered', dup2.statusCode === 409 && dup2.payload.error === 'already_registered');
  const bad = await call('POST', 'register-referral', {
    cookie: contractorCookie(row2.id),
    body: { businessName: 'Bad Industry LLC', ownerName: 'Bob', ownerEmail: 'bob@bad.test', industry: 'crypto-casino' }
  });
  check('unknown industry -> 400', bad.statusCode === 400);
}
{
  // Referral pipeline: forward-only, fee computed on license close.
  const back = await call('POST', 'advance-referral', {
    cookie: deskCookie(), body: { referralId: refId, status: 'fee_paid' }
  });
  check('skipping pipeline steps -> 409', back.statusCode === 409, back.payload);
  const a1 = await call('POST', 'advance-referral', {
    cookie: deskCookie(), body: { referralId: refId, status: 'agreement_signed' }
  });
  check('registered -> agreement_signed', a1.statusCode === 200 && a1.payload.referral.status === 'agreement_signed', a1.payload);
  const a2 = await call('POST', 'advance-referral', {
    cookie: deskCookie(), body: { referralId: refId, status: 'license_closed', licenseValue: 250000 }
  });
  check('license close on $250,000 computes fee $5,000',
    a2.statusCode === 200 && a2.payload.referral.status === 'license_closed' && a2.payload.referral.feeAmount === 5000, a2.payload);
  const a3 = await call('POST', 'advance-referral', {
    cookie: deskCookie(), body: { referralId: refId, status: 'fee_paid' }
  });
  check('license_closed -> fee_paid stamps payment',
    a3.statusCode === 200 && a3.payload.referral.status === 'fee_paid' && !!a3.payload.referral.feePaidAt, a3.payload);
  const me = await call('GET', 'me', { cookie: ck() });
  check('contractor sees their own referral + fee in me',
    me.payload.referrals.length === 1 && me.payload.referrals[0].feeAmount === 5000, me.payload);
}

/* ============ activation completes once both signatures land ============ */
console.log('activation after signing');
{
  // Invite on a revoked contractor is refused.
  await storeMod.updateContractor(ctrId, { status: 'revoked' });
  const r = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: ctrId } });
  check('invite on revoked contractor -> 409', r.statusCode === 409 && r.payload.error === 'revoked', r.payload);
  await storeMod.updateContractor(ctrId, { status: 'invited' });
}
{
  // The NDA was signed in the portal block above; the agreement was
  // signed earlier. The original link (never consumed) now works.
  const res = await rawActivate(activationToken);
  check('activation redirects to the portal with a session cookie',
    res.statusCode === 302 && res.headers.Location === '/contractors-portal.html'
    && String(res.headers['Set-Cookie'] || '').startsWith('contractor_session='), { status: res.statusCode, headers: res.headers });
  check('contractor is active after activation', (await storeMod.readContractorById(ctrId)).status === 'active');
  const res2 = await rawActivate(activationToken);
  check('activation link is single-use (second use 401)', res2.statusCode === 401, res2.payload);
}

/* ================= admin gating + contractor scoping ================= */
console.log('admin gating and scoping');
{
  const r = await call('GET', 'admin-list', { cookie: ck() });
  check('admin-list with a contractor cookie -> 401', r.statusCode === 401, r.payload);
}
{
  const r = await call('GET', 'admin-list', { cookie: deskCookie() });
  check('admin-list with a Desk session lists contractors + referrals',
    r.statusCode === 200 && r.payload.ok && r.payload.contractors.length === 2 && r.payload.referrals.length === 1, r.payload);
}
{
  // A contractor never sees another contractor's referrals.
  const row2 = await storeMod.readContractorByEmail('second@example.test');
  const me2 = await call('GET', 'me', { cookie: contractorCookie(row2.id) });
  check('second contractor sees zero referrals (strict scoping)',
    me2.statusCode === 200 && me2.payload.referrals.length === 0, me2.payload);
}
{
  // Status machine: paused -> active ok; active -> invited refused; revoked is terminal.
  const row2 = await storeMod.readContractorByEmail('second@example.test');
  const p = await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: row2.id, status: 'paused' } });
  check('active -> paused ok', p.statusCode === 200 && p.payload.status === 'paused', p.payload);
  const back2 = await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: row2.id, status: 'invited' } });
  check('paused -> invited refused (invited is never a settable target)', back2.statusCode === 409);
  const r3 = await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: row2.id, status: 'revoked' } });
  check('paused -> revoked ok', r3.statusCode === 200 && r3.payload.status === 'revoked');
  // Partner Portal rule: a revoked partner keeps a read-only FROZEN
  // view of his own clients — but every write is refused.
  const me3 = await call('GET', 'me', { cookie: contractorCookie(row2.id) });
  check('revoked contractor gets the frozen view (200, frozen, own clients only)',
    me3.statusCode === 200 && me3.payload.ok && me3.payload.frozen === true
    && me3.payload.contractor.status === 'revoked' && me3.payload.referrals.length === 0, me3.payload);
  const w = await call('POST', 'register-referral', {
    cookie: contractorCookie(row2.id),
    body: { businessName: 'Frozen Write LLC', ownerName: 'X', ownerEmail: 'x@frozen.test', industry: 'pharmacy' }
  });
  check('revoked contractor cannot write (401)', w.statusCode === 401, w.payload);
}
{
  // Logout clears the cookie.
  const r = await call('POST', 'logout', { cookie: ck() });
  check('logout clears the session cookie',
    r.statusCode === 200 && String(r.headers['Set-Cookie'] || '').includes('Max-Age=0'), r.headers);
}
{
  // No database configured -> honest 503, nothing faked.
  storeMod.__setDbUrlOverride('');
  const r = await call('GET', 'me', { cookie: ck() });
  check('unconfigured store -> 503 not_configured', r.statusCode === 503 && r.payload.error === 'not_configured', r.payload);
  storeMod.__setDbUrlOverride(undefined);
}

console.log(failures === 0 ? `\nALL GREEN — 0 failures` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
