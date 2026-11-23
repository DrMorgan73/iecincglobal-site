/* Local test suite — Partner Portal username + password auth
   (Nov 23, 2026): api/contractors.js against the mocked Neon
   store (in-memory tables) and a mocked Resend endpoint that
   captures outgoing mail. Proves DrMorgan's amended sequence end
   to end at handler level:

     COMPANY partner: office invite -> activation code -> choose
       COMPANY -> application (stored, type on the record) ->
       create username + password -> agreement -> NDA -> code
       sign-in -> dashboard (own log only) -> sign out ->
       username/password sign-in (case-insensitive username) ->
       wrong password generic 401 -> forgot -> reset email ->
       reset kills the old session -> new password works, old
       fails -> reset link single-use -> the activation code
       cannot serve as a recurrent login.
     MIGRATION partner: already active, both signatures, NO
       credentials -> link sign-in -> me reports credentialsSet
       false (the portal's gate) -> set credentials on the
       session -> username/password sign-in works; data and
       client untouched.
     INDIVIDUAL partner: choose INDIVIDUAL -> application ->
       credentials; login before signatures stand answers
       signatures_outstanding; a taken username (any case) is
       refused.
     DESK: admin-reset-password emails a reset link for a
       credentialed partner, 409 for one without credentials.
     RECOVER narrowing: a credentialed partner gets NO fresh
       activation link from recover (password reset supersedes).

   Run: node scripts/partner-portal-credentials.test.mjs   (exit 1 on failure) */

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
const storeMod = await import('../api/_contractors-store.js');

function deskCookie(user = 'drmorgan', exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac('sha256', DESK_SECRET).update(`${user}.${exp}`).digest('hex');
  return `desk_session=${user}.${exp}.${sig}`;
}
function contractorCookie(id, exp = Math.floor(Date.now() / 1000) + 3600) {
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
const sessionOf = (res) => String(res.headers['Set-Cookie'] || '').split(';')[0];

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

const LOGIN_GENERIC = 'That username or password did not work — check both and try again.';
const FORGOT_GENERIC = 'If that email matches a partner record with a password set, a reset link is on its way.';
const PW_A = 'correct-horse-23';
const PW_A2 = 'brand-new-pass-23';
const PW_B = 'migration-pass-23';

/* ================= COMPANY partner: the full amended sequence ================= */
console.log('company partner — invite -> type -> application -> credentials -> signatures -> dashboard');
let aId = null, tokenA = null, sessionA = null;
{
  const r = await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Aaa', email: 'partner-a@example.test', company: 'Aaa Ventures LLC' } });
  check('partner A registers (office record)', r.payload.ok === true, r.payload);
  aId = (await storeMod.readContractorByEmail('partner-a@example.test')).id;
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: aId } });
  check('office invite mints A an activation link', inv.statusCode === 200 && !!inv.payload.activationUrl, inv.payload);
  tokenA = new URL(inv.payload.activationUrl).searchParams.get('token');
}
{
  const st = await call('GET', 'agreement', { cookie: null, query: `token=${encodeURIComponent(tokenA)}` });
  check('chain state before registration: no type, no credentials',
    st.statusCode === 200 && st.payload.registrationType === '' && st.payload.credentialsSet === false, st.payload);
  const bad = await call('POST', 'registration', { cookie: null, body: { registrationType: 'company', name: 'X', phone: '1', addressStreet: 's', addressCity: 'c', addressState: 'MA', addressZip: '02136' } });
  check('registration without the activation token -> 401', bad.statusCode === 401, bad.payload);
  const badType = await call('POST', 'registration', { cookie: null, body: { token: tokenA, registrationType: 'trust', name: 'X', phone: '1', addressStreet: 's', addressCity: 'c', addressState: 'MA', addressZip: '02136' } });
  check('registration with an invalid type -> 400', badType.statusCode === 400, badType.payload);
  const reg = await call('POST', 'registration', { cookie: null, body: {
    token: tokenA, registrationType: 'company', name: 'Test Partner Aaa', company: 'Aaa Ventures LLC',
    phone: '617-555-0101', addressStreet: '1 Main St', addressCity: 'Boston', addressState: 'MA', addressZip: '02136',
    website: 'https://aaa.example.test'
  } });
  check('COMPANY application accepted', reg.statusCode === 200 && reg.payload.ok === true && reg.payload.registrationType === 'company', reg.payload);
  const stored = await storeMod.readContractorById(aId);
  check('the Desk record stores type + application fields',
    stored.registrationType === 'company' && stored.phone === '617-555-0101'
    && stored.addressCity === 'Boston' && stored.website === 'https://aaa.example.test', stored);
}
{
  const weak = await call('POST', 'set-credentials', { cookie: null, body: { token: tokenA, username: 'partner.aaa', password: 'short' } });
  check('set-credentials with a short password -> 400', weak.statusCode === 400 && weak.payload.error === 'weak_password', weak.payload);
  const badName = await call('POST', 'set-credentials', { cookie: null, body: { token: tokenA, username: 'a!', password: PW_A } });
  check('set-credentials with an invalid username -> 400', badName.statusCode === 400 && badName.payload.error === 'invalid_username', badName.payload);
  const set = await call('POST', 'set-credentials', { cookie: null, body: { token: tokenA, username: 'Partner.Aaa', password: PW_A } });
  check('credentials set (username kept as typed)', set.statusCode === 200 && set.payload.ok === true && set.payload.username === 'Partner.Aaa', set.payload);
  const creds = await storeMod.readContractorCredentials(aId);
  check('password stored as scrypt hash + salt, never plaintext',
    !!creds.passwordHash && !!creds.passwordSalt && creds.passwordHash !== PW_A && !JSON.stringify(creds).includes(PW_A), creds && creds.username);
  const again = await call('POST', 'set-credentials', { cookie: null, body: { token: tokenA, username: 'other.name', password: PW_A } });
  check('credentials cannot be set twice through the chain -> 409', again.statusCode === 409 && again.payload.error === 'credentials_already_set', again.payload);
  const pub = await storeMod.readContractorById(aId);
  check('public record exposes username + credentialsSet, never the hash',
    pub.username === 'Partner.Aaa' && pub.credentialsSet === true && pub.passwordHash === undefined, pub);
}
{
  const early = await call('POST', 'login', { cookie: null, body: { username: 'partner.aaa', password: PW_A } });
  check('login before signatures stand -> signatures_outstanding (no session)',
    early.statusCode === 200 && early.payload.ok === false && early.payload.error === 'signatures_outstanding'
    && !early.headers['Set-Cookie'], early.payload);
  const acc = await call('POST', 'accept-agreement', { cookie: null, body: { token: tokenA, typedName: 'Test Partner Aaa', accept: true } });
  check('agreement accepted in-portal', acc.statusCode === 200 && acc.payload.ok === true, acc.payload);
  const nda = await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: aId, signed: true } });
  check('office records the NDA', nda.statusCode === 200 && nda.payload.ok === true, nda.payload);
  const signin = await call('POST', 'signin', { cookie: null, body: { credential: tokenA } });
  check('activation code sign-in -> dashboard + session',
    signin.statusCode === 200 && signin.payload.next === 'dashboard' && sessionOf(signin).startsWith('contractor_session='), signin.payload);
  sessionA = sessionOf(signin);
  const me = await call('GET', 'me', { cookie: sessionA });
  check('dashboard payload: A, active, credentialsSet true, username present',
    me.statusCode === 200 && me.payload.contractor.id === aId && me.payload.contractor.status === 'active'
    && me.payload.contractor.credentialsSet === true && me.payload.contractor.username === 'Partner.Aaa', me.payload.contractor);
  const client = await call('POST', 'register-referral', {
    cookie: sessionA,
    body: { businessName: 'Aaa Client Corp', ownerName: 'Ann Aaa', ownerEmail: 'ann@aaaclient.test', industry: 'home-health', deskStaffBand: '20-34' }
  });
  check('A registers his own client', client.statusCode === 200, client.payload);
  const reuse = await call('POST', 'signin', { cookie: null, body: { credential: tokenA } });
  check('the activation code a second time -> 401 (single-use)', reuse.statusCode === 401, reuse.payload);
}

/* ================= recurrent sign-in ================= */
console.log('recurrent sign-in — username + password');
let sessionA2 = null;
{
  await call('POST', 'logout', { cookie: sessionA });
  const wrong = await call('POST', 'login', { cookie: null, body: { username: 'partner.aaa', password: 'wrong-password-99' } });
  check('wrong password -> generic 401', wrong.statusCode === 401 && wrong.payload.message === LOGIN_GENERIC, wrong.payload);
  const unknown = await call('POST', 'login', { cookie: null, body: { username: 'nobody.here', password: PW_A } });
  check('unknown username -> the SAME generic 401', unknown.statusCode === 401 && unknown.payload.message === LOGIN_GENERIC, unknown.payload);
  const codeAsPw = await call('POST', 'login', { cookie: null, body: { username: 'partner.aaa', password: tokenA } });
  check('the activation code as a password -> generic 401', codeAsPw.statusCode === 401 && codeAsPw.payload.message === LOGIN_GENERIC, codeAsPw.payload);
  const codeAsUser = await call('POST', 'login', { cookie: null, body: { username: tokenA, password: PW_A } });
  check('the activation code as a username -> generic 401', codeAsUser.statusCode === 401, codeAsUser.payload);
  const ok = await call('POST', 'login', { cookie: null, body: { username: 'PARTNER.AAA', password: PW_A } });
  check('username match is case-insensitive -> dashboard session',
    ok.statusCode === 200 && ok.payload.next === 'dashboard' && sessionOf(ok).startsWith('contractor_session='), ok.payload);
  sessionA2 = sessionOf(ok);
  const me = await call('GET', 'me', { cookie: sessionA2 });
  check('recurrent dashboard shows A\'s own log only',
    me.statusCode === 200 && (me.payload.clients || []).length === 1
    && me.payload.clients[0].businessName === 'Aaa Client Corp', me.payload.clients);
}

/* ================= forgot + reset ================= */
console.log('forgot password -> reset -> old session dead, old password dead');
let resetToken = null;
{
  const before = sentMail.length;
  const unk = await call('POST', 'forgot-password', { cookie: null, body: { email: 'nobody@example.test' } });
  check('forgot (unknown email) -> generic 200, no mail',
    unk.statusCode === 200 && unk.payload.message === FORGOT_GENERIC && sentMail.length === before, unk.payload);
  const r = await call('POST', 'forgot-password', { cookie: null, body: { email: 'partner-a@example.test' } });
  check('forgot (A) -> generic 200 + exactly one reset email',
    r.statusCode === 200 && r.payload.message === FORGOT_GENERIC && sentMail.length === before + 1, r.payload);
  const mail = sentMail[sentMail.length - 1];
  check('reset mail: from info@, reset subject, IEC signature, no cc',
    /info@iecincglobal\.com/.test(mail.from) && mail.subject === 'Reset your IEC Partner Portal password'
    && /Mohammed Morgan, MD/.test(mail.text) && !mail.cc && !mail.bcc, { from: mail.from, subject: mail.subject });
  const m = String(mail.text).match(/reset-password\?t=([^\s]+)/);
  resetToken = m ? decodeURIComponent(m[1]) : null;
  check('reset mail carries the reset link', !!resetToken);
}
{
  const weak = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken, password: 'short' } });
  check('reset with a short password -> 400', weak.statusCode === 400 && weak.payload.error === 'weak_password', weak.payload);
  const bogus = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken + 'x', password: PW_A2 } });
  check('reset with a tampered token -> 401', bogus.statusCode === 401, bogus.payload);
  const done = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken, password: PW_A2 } });
  check('reset succeeds', done.statusCode === 200 && done.payload.ok === true, done.payload);
  const deadSession = await call('GET', 'me', { cookie: sessionA2 });
  check('the pre-reset session is dead (epoch bumped)', deadSession.statusCode === 401, deadSession.payload);
  const reuse = await call('POST', 'reset-password', { cookie: null, body: { token: resetToken, password: PW_A } });
  check('the reset link cannot be replayed -> 401', reuse.statusCode === 401, reuse.payload);
  const oldPw = await call('POST', 'login', { cookie: null, body: { username: 'partner.aaa', password: PW_A } });
  check('the OLD password no longer signs in -> generic 401', oldPw.statusCode === 401 && oldPw.payload.message === LOGIN_GENERIC, oldPw.payload);
  const newPw = await call('POST', 'login', { cookie: null, body: { username: 'partner.aaa', password: PW_A2 } });
  check('the NEW password signs in', newPw.statusCode === 200 && newPw.payload.next === 'dashboard', newPw.payload);
}
{
  const before = sentMail.length;
  const r = await call('POST', 'recover', { cookie: null, body: { email: 'partner-a@example.test' } });
  check('recover for a CREDENTIALED partner -> generic 200, NO activation link (reset supersedes)',
    r.statusCode === 200 && r.payload.ok === true && sentMail.length === before, r.payload);
}

/* ================= MIGRATION partner ================= */
console.log('migration — active partner with no credentials routes through set-credentials');
let bId = null;
{
  await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Bbb', email: 'partner-b@example.test', company: 'Bbb Holdings LLC' } });
  bId = (await storeMod.readContractorByEmail('partner-b@example.test')).id;
  await storeMod.updateContractor(bId, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed' });
  const client = await call('POST', 'register-referral', {
    cookie: contractorCookie(bId),
    body: { businessName: 'Bbb Client Corp', ownerName: 'Bob Bbb', ownerEmail: 'bob@bbbclient.test', industry: 'pharmacy', deskStaffBand: '20-34' }
  });
  check('B already holds a client', client.statusCode === 200, client.payload);
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: bId } });
  const tokenB = new URL(inv.payload.activationUrl).searchParams.get('token');
  const signin = await call('POST', 'signin', { cookie: null, body: { credential: tokenB } });
  check('B link sign-in -> dashboard session', signin.statusCode === 200 && signin.payload.next === 'dashboard', signin.payload);
  const sessionB = sessionOf(signin);
  const me = await call('GET', 'me', { cookie: sessionB });
  check('me reports credentialsSet FALSE (the portal gate condition), client intact',
    me.statusCode === 200 && me.payload.contractor.credentialsSet === false
    && (me.payload.clients || []).length === 1 && me.payload.clients[0].businessName === 'Bbb Client Corp', me.payload.contractor);
  const set = await call('POST', 'set-credentials', { cookie: sessionB, body: { username: 'partner.bbb', password: PW_B } });
  check('B sets credentials on his session (no token)', set.statusCode === 200 && set.payload.ok === true, set.payload);
  const me2 = await call('GET', 'me', { cookie: sessionB });
  check('me now reports credentialsSet true; data untouched',
    me2.payload.contractor.credentialsSet === true && (me2.payload.clients || []).length === 1, me2.payload.contractor);
  await call('POST', 'logout', { cookie: sessionB });
  const login = await call('POST', 'login', { cookie: null, body: { username: 'partner.bbb', password: PW_B } });
  check('B signs in recurrently with username + password', login.statusCode === 200 && login.payload.next === 'dashboard', login.payload);
  const iso = await call('GET', 'me', { cookie: sessionOf(login) });
  check('cross-partner isolation: B sees only B\'s client',
    (iso.payload.clients || []).length === 1 && iso.payload.clients[0].businessName === 'Bbb Client Corp'
    && JSON.stringify(iso.payload).includes('Aaa Client Corp') === false, iso.payload.clients);
}

/* ================= INDIVIDUAL partner + username uniqueness ================= */
console.log('individual partner — type choice stored; username uniqueness is case-insensitive');
{
  await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Ccc', email: 'partner-c@example.test', company: 'Ccc Placeholder LLC' } });
  const cId = (await storeMod.readContractorByEmail('partner-c@example.test')).id;
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: cId } });
  const tokenC = new URL(inv.payload.activationUrl).searchParams.get('token');
  const reg = await call('POST', 'registration', { cookie: null, body: {
    token: tokenC, registrationType: 'individual', name: 'Test Partner Ccc', company: '',
    phone: '617-555-0103', addressStreet: '9 Oak Ave', addressCity: 'Cambridge', addressState: 'MA', addressZip: '02139'
  } });
  check('INDIVIDUAL application accepted', reg.statusCode === 200 && reg.payload.registrationType === 'individual', reg.payload);
  const stored = await storeMod.readContractorById(cId);
  check('the Desk record stores registration_type individual', stored.registrationType === 'individual', stored);
  const taken = await call('POST', 'set-credentials', { cookie: null, body: { token: tokenC, username: 'PARTNER.AAA', password: 'some-password-23' } });
  check('a taken username in another case -> 409 username_taken', taken.statusCode === 409 && taken.payload.error === 'username_taken', taken.payload);
  const set = await call('POST', 'set-credentials', { cookie: null, body: { token: tokenC, username: 'partner.ccc', password: 'some-password-23' } });
  check('C sets his own credentials', set.statusCode === 200 && set.payload.ok === true, set.payload);
  const st = await call('GET', 'agreement', { cookie: null, query: `token=${encodeURIComponent(tokenC)}` });
  check('chain state now shows type individual + credentialsSet true (chain resumes at signatures)',
    st.payload.registrationType === 'individual' && st.payload.credentialsSet === true, st.payload);
}

/* ================= Desk: credential state + reset action ================= */
console.log('desk — credential state on the record + admin reset action');
{
  const list = await call('GET', 'admin-list', { cookie: deskCookie() });
  const aRow = (list.payload.contractors || []).find(x => x.id === aId);
  check('admin-list carries A\'s credential state (username + set + type), no hash',
    !!aRow && aRow.username === 'Partner.Aaa' && aRow.credentialsSet === true && aRow.registrationType === 'company'
    && aRow.passwordHash === undefined && aRow.passwordSalt === undefined, aRow && { u: aRow.username, cs: aRow.credentialsSet });
  const before = sentMail.length;
  const r = await call('POST', 'admin-reset-password', { cookie: deskCookie(), body: { contractorId: aId } });
  check('Desk emails A a password-reset link (record named in the response)',
    r.statusCode === 200 && r.payload.ok === true && r.payload.contractorId === aId
    && sentMail.length === before + 1 && sentMail[sentMail.length - 1].subject === 'Reset your IEC Partner Portal password', r.payload);
  await call('POST', 'register', { cookie: null, body: { name: 'Test Partner Ddd', email: 'partner-d@example.test', company: 'Ddd LLC' } });
  const dId = (await storeMod.readContractorByEmail('partner-d@example.test')).id;
  const noCreds = await call('POST', 'admin-reset-password', { cookie: deskCookie(), body: { contractorId: dId } });
  check('Desk reset for a partner WITHOUT credentials -> 409 no_credentials', noCreds.statusCode === 409 && noCreds.payload.error === 'no_credentials', noCreds.payload);
  const noDesk = await call('POST', 'admin-reset-password', { cookie: null, body: { contractorId: aId } });
  check('admin-reset-password without a Desk session -> 401', noDesk.statusCode === 401, noDesk.payload);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
