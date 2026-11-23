/* Local test suite — Partner Portal ADMIN account (Nov 23, 2026).
   DrMorgan's order: "create me Admin access username DrMorgan73".
   Proves, at handler level against the mocked Neon store and a
   mocked Resend endpoint:

     - the office account is a contractor row with role 'admin',
       username DrMorgan73 (normalized drmorgan73), status active,
       NO password, NO client/invite codes, signatures pending
       (the partner gates do not apply to IEC itself);
     - forgot-password emails it the portal's own single-use
       set/reset link at info@iecincglobal.com, from
       IEC, Inc. <info@iecincglobal.com>, no cc — the stored hash
       lands only because the send succeeded;
     - reset-password sets the first password (>= 12 chars), the
       link is single-use, and login then works case-insensitively
       WITHOUT the signature gates; a wrong password gets the one
       generic 401;
     - `me` reports role 'admin' and issues no codes;
     - admin-overview serves the partners/states/referrals
       summary to the admin session ONLY (partner session 403,
       no session 401) and EXCLUDES the admin record itself;
     - the Desk's admin-list also excludes the admin record, and
       the client-code backfill never issues the admin a code;
     - a partner with neither username nor password gets NO mail
       from forgot-password (his path stays the activation link).

   Run: node scripts/partner-portal-admin.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';

const SECRET = 'test-contractor-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'postgres://test:test@neon-sql.test/iec_questionnaires?sslmode=require';

/* ---------------- mocked Neon SQL endpoint ---------------- */
const TABLES = {
  contractors: new Map(), contractor_referrals: new Map(), client_claims: new Map(),
  contractor_link_holds: new Map(), client_cnda_records: new Map(), contractor_tax_forms: new Map()
};

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
const sentMail = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
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
const storeMod = await import('../api/_contractors-store.js');
const authMod = await import('../api/_contractors-auth.js');

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
async function call(method, action, { body, cookie, query } = {}) {
  const url = '/api/contractors' + (action ? `?action=${action}` : '') + (query ? `&${query}` : '');
  const req = { method, url, headers: cookie === null ? {} : { cookie: cookie ?? '', host: 'partners.iecincglobal.com' }, body };
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
const sessionOf = (res) => String(res.headers['Set-Cookie'] || '').split(';')[0];

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

const LOGIN_GENERIC = 'That username or password did not work — check both and try again.';
const ADMIN_PW = 'drmorgan-first-pass-1';
const PARTNER_PW = 'partner-p-pass-123';

/* ================= fixtures: one partner + the admin account ================= */
console.log('fixtures — a signed active partner, and the office admin account');
const partnerId = crypto.randomUUID();
await storeMod.createContractor({
  id: partnerId, email: 'partner-p@example.test', name: 'Partner P', company: 'P Ventures LLC',
  activationTokenHash: '', source: 'office-invite'
});
await storeMod.updateContractor(partnerId, {
  status: 'active', ndaStatus: 'signed', agreementStatus: 'signed',
  activatedAt: new Date().toISOString()
});
const refId = crypto.randomUUID();
await storeMod.createReferral({
  id: refId, contractorId: partnerId, businessName: 'P Client Inc',
  ownerName: 'Pat Owner', ownerEmail: 'pat@pclient.test', industry: 'pharmacy'
});
const { salt: pSalt, hash: pHash } = authMod.hashPassword(PARTNER_PW);
await storeMod.updateContractor(partnerId, {
  username: 'Partner.P', usernameNormalized: 'partner.p',
  passwordHash: pHash, passwordSalt: pSalt, credentialsSetAt: new Date().toISOString()
});

/* A second partner with NEITHER username nor password (invited,
   signatures stand) — forgot-password must send him nothing. */
const noCredId = crypto.randomUUID();
await storeMod.createContractor({
  id: noCredId, email: 'nocred@example.test', name: 'No Cred', company: 'NoCred LLC',
  activationTokenHash: '', source: 'office-invite'
});
await storeMod.updateContractor(noCredId, {
  status: 'active', ndaStatus: 'signed', agreementStatus: 'signed',
  activatedAt: new Date().toISOString()
});

/* The admin account, created exactly as the office creates it in
   production: a contractor row, then the office fields. */
const adminId = crypto.randomUUID();
await storeMod.createContractor({
  id: adminId, email: 'info@iecincglobal.com', name: 'Mohammed Morgan', company: 'IEC, Inc.',
  activationTokenHash: '', source: 'office-admin',
  notes: 'IEC office / admin account — not a referral partner.'
});
await storeMod.updateContractor(adminId, {
  status: 'active', role: 'admin',
  username: 'DrMorgan73', usernameNormalized: 'drmorgan73',
  activatedAt: new Date().toISOString()
});
{
  const c = await storeMod.readContractorByUsername('drmorgan73');
  check('admin record resolves by normalized username', !!c && c.id === adminId, c);
  check('admin role + active, no password, no codes, signatures untouched (pending)',
    c.role === 'admin' && c.status === 'active' && c.credentialsSet === false
    && !c.clientCode && !c.inviteCode && c.ndaStatus === 'pending' && c.agreementStatus === 'pending', c);
}

/* ================= the set-password email (portal's own path) ================= */
console.log('forgot-password — the office account receives its set-password link');
let resetToken = null;
{
  const before = sentMail.length;
  const r = await call('POST', 'forgot-password', { cookie: null, body: { email: 'info@iecincglobal.com' } });
  check('generic 200 (no enumeration)', r.statusCode === 200 && r.payload.ok === true, r.payload);
  check('exactly one email sent', sentMail.length === before + 1, sentMail.length);
  const mail = sentMail[sentMail.length - 1];
  check('from IEC, Inc. <info@iecincglobal.com>, to info@ only, no cc',
    mail.from === 'IEC, Inc. <info@iecincglobal.com>'
    && JSON.stringify(mail.to) === JSON.stringify(['info@iecincglobal.com'])
    && !mail.cc && !mail.bcc, mail);
  check('subject is the portal password-reset subject', mail.subject === 'Reset your IEC Partner Portal password', mail.subject);
  const m = String(mail.text || '').match(/\/reset-password\?t=([^\s]+)/);
  check('the email carries the reset link', !!m, mail.text && mail.text.slice(0, 120));
  resetToken = m ? decodeURIComponent(m[1]) : null;
  const stored = await storeMod.readPasswordReset(adminId);
  check('reset hash stored (send succeeded), expiry about one hour out',
    !!stored.tokenHash && Date.parse(stored.expiresAt) > Date.now() + 30 * 60000
    && Date.parse(stored.expiresAt) < Date.now() + 61 * 60000, stored);
}
{
  const before = sentMail.length;
  const r = await call('POST', 'forgot-password', { cookie: null, body: { email: 'nocred@example.test' } });
  check('credential-less partner: generic 200 and NO email (activation link stays his path)',
    r.statusCode === 200 && sentMail.length === before, r.payload);
}

/* ================= set the password, then sign in ================= */
console.log('reset-password + login — DrMorgan sets his own password');
{
  const early = await call('POST', 'login', { cookie: null, body: { username: 'DrMorgan73', password: ADMIN_PW } });
  check('login before the password is set -> generic 401',
    early.statusCode === 401 && early.payload.message === LOGIN_GENERIC, early.payload);
  const weak = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken, password: 'short' } });
  check('reset with a short password -> 400 weak_password',
    weak.statusCode === 400 && weak.payload.error === 'weak_password', weak.payload);
  const set = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken, password: ADMIN_PW } });
  check('reset sets the first password', set.statusCode === 200 && set.payload.ok === true, set.payload);
  const after = await storeMod.readContractorById(adminId);
  check('credentials now set on the record', after.credentialsSet === true, after);
  const replay = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken, password: 'another-pass-1234' } });
  check('the link is single-use -> replay 401', replay.statusCode === 401, replay.payload);
}
let adminSession = null;
{
  const wrong = await call('POST', 'login', { cookie: null, body: { username: 'DrMorgan73', password: 'not-the-password-1' } });
  check('wrong password -> the one generic 401',
    wrong.statusCode === 401 && wrong.payload.error === 'login_failed' && wrong.payload.message === LOGIN_GENERIC
    && !wrong.headers['Set-Cookie'], wrong.payload);
  const okLogin = await call('POST', 'login', { cookie: null, body: { username: 'DrMorgan73', password: ADMIN_PW } });
  check('login succeeds with NO signatures standing (admin is IEC itself)',
    okLogin.statusCode === 200 && okLogin.payload.ok === true && sessionOf(okLogin).startsWith('contractor_session='), okLogin.payload);
  adminSession = sessionOf(okLogin);
  const lower = await call('POST', 'login', { cookie: null, body: { username: 'drmorgan73', password: ADMIN_PW } });
  check('username match is case-insensitive (drmorgan73 also signs in)',
    lower.statusCode === 200 && lower.payload.ok === true, lower.payload);
}

/* ================= me + admin-overview ================= */
console.log('me + admin-overview — the office view, admin session only');
{
  const me = await call('GET', 'me', { cookie: adminSession });
  check('me reports role admin, no client code/link, empty own book',
    me.statusCode === 200 && me.payload.contractor.role === 'admin'
    && me.payload.clientCode === '' && me.payload.clientLink === ''
    && Array.isArray(me.payload.referrals) && me.payload.referrals.length === 0, me.payload.contractor);
  const after = await storeMod.readContractorById(adminId);
  check('me issued the admin NO client/invite codes', !after.clientCode && !after.inviteCode, after);

  const ov = await call('GET', 'admin-overview', { cookie: adminSession });
  check('admin-overview serves the admin session', ov.statusCode === 200 && ov.payload.ok === true, ov.payload);
  const ids = (ov.payload.contractors || []).map(x => x.id);
  check('overview lists the partner and EXCLUDES the admin record',
    ids.includes(partnerId) && !ids.includes(adminId), ids);
  check('overview carries the partner\u2019s referral',
    (ov.payload.referrals || []).some(r => r.id === refId && r.contractorId === partnerId), ov.payload.referrals);
  const listedPartner = (ov.payload.contractors || []).find(x => x.id === partnerId);
  check('listed partner carries fee totals + sign-in state',
    !!listedPartner && !!listedPartner.feeTotals && listedPartner.username === 'Partner.P'
    && listedPartner.credentialsSet === true, listedPartner);

  const pLogin = await call('POST', 'login', { cookie: null, body: { username: 'partner.p', password: PARTNER_PW } });
  const pSession = sessionOf(pLogin);
  check('partner login works (fixture sanity)', pLogin.statusCode === 200 && !!pSession, pLogin.payload);
  const forbidden = await call('GET', 'admin-overview', { cookie: pSession });
  check('a partner session gets 403 on admin-overview',
    forbidden.statusCode === 403 && forbidden.payload.error === 'forbidden', forbidden.payload);
  const anon = await call('GET', 'admin-overview', { cookie: null });
  check('no session gets 401 on admin-overview', anon.statusCode === 401, anon.payload);
}

/* ================= the Desk list excludes the admin ================= */
console.log('admin-list (Desk) — the office account never appears as a partner');
{
  const list = await call('GET', 'admin-list', { cookie: deskCookie() });
  const ids = (list.payload.contractors || []).map(x => x.id);
  check('Desk list includes partners, excludes the admin record',
    list.statusCode === 200 && ids.includes(partnerId) && ids.includes(noCredId) && !ids.includes(adminId), ids);
  const after = await storeMod.readContractorById(adminId);
  check('the backfill inside admin-list issued the admin NO client code',
    !after.clientCode, after);
  const noDesk = await call('GET', 'admin-list', { cookie: adminSession });
  check('the admin\u2019s portal session opens the office surface (full dashboard build, Nov 23, 2026)',
    noDesk.statusCode === 200, noDesk.payload);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
