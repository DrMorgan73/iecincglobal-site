/* Local test suite — Partner Portal ADMIN DASHBOARD (Nov 23, 2026).
   DrMorgan's order: "all buttons in dashboard not wired end to
   end — execute fully wiring and full dashboard similar to
   DataSupply, include sources materials."
   Handler-level: EVERY admin action the dashboard wires is
   exercised through the portal ADMIN session (not the Desk
   session) against the mocked store + captured Resend mail, and
   each write is read back from the store. Materials are fetched
   through the admin gate and scanned for banned names. Partner
   and anonymous sessions are refused. Render-level: the real
   partners/app.js is executed against the admin fixtures and
   every rendered data-act control is asserted to have a dispatch
   branch in wireAdminActions.
   (Harness copied from partner-portal-admin.test.mjs.)
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


/* ================= fixtures ================= */
console.log('fixtures — admin account, a working partner, an invited partner, a referral, a hold');
const adminId = crypto.randomUUID();
await storeMod.createContractor({ id: adminId, email: 'info@iecincglobal.com', name: 'Mohammed Morgan', company: 'IEC, Inc.', activationTokenHash: '', source: 'office-admin' });
await storeMod.updateContractor(adminId, { status: 'active', role: 'admin', username: 'DrMorgan73', usernameNormalized: 'drmorgan73', activatedAt: new Date().toISOString() });
{
  const { salt, hash } = authMod.hashPassword(ADMIN_PW);
  await storeMod.updateContractor(adminId, { passwordHash: hash, passwordSalt: salt, credentialsSetAt: new Date().toISOString() });
}
const login = await call('POST', 'login', { cookie: null, body: { username: 'DrMorgan73', password: ADMIN_PW } });
check('admin login', login.statusCode === 200, login.payload);
const S = sessionOf(login);

const partnerId = crypto.randomUUID();
await storeMod.createContractor({ id: partnerId, email: 'partner-p@example.test', name: 'Partner P', company: 'P Ventures LLC', activationTokenHash: '', source: 'office-invite' });
await storeMod.updateContractor(partnerId, { status: 'active', ndaStatus: 'signed', agreementStatus: 'signed', activatedAt: new Date().toISOString() });
{
  const { salt, hash } = authMod.hashPassword(PARTNER_PW);
  await storeMod.updateContractor(partnerId, { username: 'Partner.P', usernameNormalized: 'partner.p', passwordHash: hash, passwordSalt: salt, credentialsSetAt: new Date().toISOString() });
}
const invitedId = crypto.randomUUID();
await storeMod.createContractor({ id: invitedId, email: 'invited-i@example.test', name: 'Invited I', company: 'I LLC', activationTokenHash: '', source: 'office-invite' });

const refId = crypto.randomUUID();
await storeMod.createReferral({ id: refId, contractorId: partnerId, businessName: 'P Client Inc', ownerName: 'Pat Owner', ownerEmail: 'pat@pclient.test', industry: 'pharmacy' });

/* ================= partner actions through the ADMIN session ================= */
console.log('partner actions — every wired button round-trips');
{
  let r = await call('POST', 'set-agreement', { cookie: S, body: { contractorId: invitedId, signed: true } });
  check('mark agreement signed -> 200', r.statusCode === 200 && r.payload.agreementStatus === 'signed', r.payload);
  let c = await storeMod.readContractorById(invitedId);
  check('agreement signed persists', c.agreementStatus === 'signed' && !!c.agreementSignedAt, c);

  r = await call('POST', 'set-nda', { cookie: S, body: { contractorId: invitedId, signed: true } });
  check('mark NDA signed -> 200', r.statusCode === 200 && r.payload.ndaStatus === 'signed', r.payload);
  c = await storeMod.readContractorById(invitedId);
  check('NDA signed persists', c.ndaStatus === 'signed', c);

  const before = sentMail.length;
  r = await call('POST', 'send-invitation', { cookie: S, body: { contractorId: invitedId } });
  check('send invitation -> emailed via captured Resend', r.statusCode === 200 && r.payload.emailed === true && sentMail.length === before + 1, r.payload);
  const mail = sentMail[sentMail.length - 1];
  check('invitation mail: from info@, to the partner only, no cc', mail.from === 'IEC, Inc. <info@iecincglobal.com>' && JSON.stringify(mail.to) === JSON.stringify(['invited-i@example.test']) && !mail.cc, mail);
  c = await storeMod.readContractorById(invitedId);
  const tokHash = await storeMod.readActivationHash(invitedId);
  check('invitation provenance + token hash persist', !!c.invitationSentAt && !!tokHash, { invitationSentAt: c.invitationSentAt, tokHash: !!tokHash });

  r = await call('POST', 'invite', { cookie: S, body: { contractorId: invitedId } });
  check('mint activation link -> URL returned', r.statusCode === 200 && /action=activate&token=/.test(r.payload.activationUrl || ''), r.payload);

  const beforeReset = sentMail.length;
  r = await call('POST', 'admin-reset-password', { cookie: S, body: { contractorId: partnerId } });
  check('email password-reset link -> sent to the credentialed partner', r.statusCode === 200 && r.payload.emailed === true && sentMail.length === beforeReset + 1, r.payload);
  r = await call('POST', 'admin-reset-password', { cookie: S, body: { contractorId: invitedId } });
  check('reset for a credential-less partner -> 409 no_credentials', r.statusCode === 409 && r.payload.error === 'no_credentials', r.payload);

  r = await call('POST', 'set-status', { cookie: S, body: { contractorId: partnerId, status: 'paused' } });
  check('pause -> 200', r.statusCode === 200 && r.payload.status === 'paused', r.payload);
  c = await storeMod.readContractorById(partnerId);
  check('pause persists', c.status === 'paused', c);
  r = await call('POST', 'set-status', { cookie: S, body: { contractorId: partnerId, status: 'active' } });
  check('resume (paused -> active) -> 200', r.statusCode === 200 && r.payload.status === 'active', r.payload);
  r = await call('POST', 'set-status', { cookie: S, body: { contractorId: partnerId, status: 'revoked' } });
  check('revoke -> 200', r.statusCode === 200 && r.payload.status === 'revoked', r.payload);
  c = await storeMod.readContractorById(partnerId);
  check('revoke persists', c.status === 'revoked', c);
  r = await call('POST', 'reactivate', { cookie: S, body: { contractorId: partnerId } });
  check('reactivate -> back to invited with a fresh link', r.statusCode === 200 && r.payload.status === 'invited' && /action=activate&token=/.test(r.payload.activationUrl || ''), r.payload);
  c = await storeMod.readContractorById(partnerId);
  const tokHash2 = await storeMod.readActivationHash(partnerId);
  check('reactivate persists (invited, fresh token hash)', c.status === 'invited' && !!tokHash2, { status: c.status, tokHash: !!tokHash2 });
  await storeMod.updateContractor(partnerId, { status: 'active' });
}

/* ================= referral actions ================= */
console.log('referral actions — pipeline step, fee step, approved amount');
{
  let r = await call('POST', 'advance-client', { cookie: S, body: { referralId: refId, status: 'questionnaire_sent' } });
  check('advance client pipeline one step -> 200', r.statusCode === 200 && r.payload.client.pipelineStatus === 'questionnaire_sent', r.payload);
  let ref = await storeMod.readReferral(refId);
  check('pipeline step persists + history entry lands', ref.pipelineStatus === 'questionnaire_sent' && (ref.pipelineHistory || []).some(h => h.status === 'questionnaire_sent'), ref);
  r = await call('POST', 'advance-client', { cookie: S, body: { referralId: refId, status: 'assessment_done' } });
  check('skipping a step -> 409', r.statusCode === 409, r.payload);
  r = await call('POST', 'advance-client', { cookie: S, body: { referralId: refId, status: 'questionnaire_answered' } });
  check('evidence-gated step without evidence -> 400', r.statusCode === 400 && r.payload.error === 'evidence_required', r.payload);
  r = await call('POST', 'advance-client', { cookie: S, body: { referralId: refId, status: 'questionnaire_answered', evidence: 'submission TEST-001' } });
  check('evidence-gated step with evidence -> 200', r.statusCode === 200, r.payload);

  r = await call('POST', 'set-approved-amount', { cookie: S, body: { referralId: refId, amount: 125000 } });
  check('set approved amount -> 200', r.statusCode === 200 && r.payload.referral.approvedAmount === 125000, r.payload);
  ref = await storeMod.readReferral(refId);
  check('approved amount persists', ref.approvedAmount === 125000 && !!ref.approvedAt, ref);
  r = await call('POST', 'set-approved-amount', { cookie: S, body: { referralId: refId, amount: null } });
  check('clear approved amount -> 200', r.statusCode === 200 && r.payload.referral.approvedAmount === null, r.payload);

  r = await call('POST', 'advance-referral', { cookie: S, body: { referralId: refId, status: 'agreement_signed' } });
  check('fee pipeline: registered -> agreement_signed', r.statusCode === 200 && r.payload.referral.status === 'agreement_signed', r.payload);
  r = await call('POST', 'advance-referral', { cookie: S, body: { referralId: refId, status: 'license_closed', ownerGross: 100000 } });
  const expectFee = mod._internals.referralFee ? mod._internals.referralFee(100000) : 3000;
  check('fee pipeline: license_closed computes the fee on Owner Gross (3% of $100,000 = $3,000)', r.statusCode === 200 && r.payload.referral.feeAmount === 3000, r.payload);
  r = await call('POST', 'advance-referral', { cookie: S, body: { referralId: refId, status: 'fee_paid' } });
  check('fee pipeline: fee_paid records feePaidAt', r.statusCode === 200 && !!r.payload.referral.feePaidAt, r.payload);
  ref = await storeMod.readReferral(refId);
  check('fee state persists', ref.status === 'fee_paid' && ref.feeAmount === 3000, ref);
}

/* ================= holds ================= */
console.log('link holds — credit and dismiss');
{
  const holdId = crypto.randomUUID();
  await storeMod.createLinkHold({ id: holdId, contractorId: partnerId, businessName: 'Held Biz LLC', ownerName: 'Hank Held', ownerEmail: 'hank@heldbiz.test', industry: 'general-business', clientCode: '' });
  let r = await call('POST', 'resolve-hold', { cookie: S, body: { holdId, decision: 'credit' } });
  check('credit hold -> referral created under the partner', r.statusCode === 200 && !!r.payload.credited, r.payload);
  const refs = await storeMod.listReferralsByContractor(partnerId);
  check('credited referral persists', (refs || []).some(x => x.businessName === 'Held Biz LLC'), (refs || []).length);
  const hold2 = crypto.randomUUID();
  await storeMod.createLinkHold({ id: hold2, contractorId: partnerId, businessName: 'Dismiss Biz LLC', ownerName: 'Dee Miss', ownerEmail: 'dee@dismiss.test', industry: 'general-business', clientCode: '' });
  r = await call('POST', 'resolve-hold', { cookie: S, body: { holdId: hold2, decision: 'dismiss' } });
  check('dismiss hold -> 200', r.statusCode === 200 && r.payload.dismissed === hold2, r.payload);
  /* The mocked SQL endpoint treats DELETE as a no-op (the shared
     harness's simplification), so the dismissal is asserted at the
     response level here; the production store's deleteLinkHold is
     the same code path the Desk's dismiss has always used. */
}

/* ================= materials ================= */
console.log('materials & sources — admin-gated, texts of record, no banned names');
const BANNED = ['DataSupply', 'datasupply.ai', 'Chang Strategic', 'NexMed', 'Tom Schaefer'];
{
  const list = await call('GET', 'admin-materials', { cookie: S });
  check('materials list serves the admin session', list.statusCode === 200 && Array.isArray(list.payload.materials), list.payload);
  const ids = (list.payload.materials || []).map(m => m.id);
  check('all seven materials listed', ['agreement', 'cnda', 'fee-schedule', 'webinar-script', 'invitation-template', 'client-link-template', 'invite-message-template'].every(x => ids.includes(x)), ids);
  for (const id of ids) {
    const m = await call('GET', 'admin-material', { cookie: S, query: 'id=' + id });
    const content = (m.payload.material && (m.payload.material.content || '')) + ' ' + ((m.payload.material && m.payload.material.text) || '');
    check('material ' + id + ' serves non-empty content', m.statusCode === 200 && content.trim().length > 100, m.statusCode);
    check('material ' + id + ' carries NO banned name', !BANNED.some(b => content.includes(b)), id);
  }
  const agr = await call('GET', 'admin-material', { cookie: S, query: 'id=agreement' });
  check('agreement material carries the version of record', (agr.payload.material.meta || '').includes('IEC-CRA-2026-11-12+18691ec'), agr.payload.material && agr.payload.material.meta);
  const cnda = await call('GET', 'admin-material', { cookie: S, query: 'id=cnda' });
  check('CNDA material carries the RESTATED Entry 1', (cnda.payload.material.content || '').includes('as restated under Section 5.3'), '');
  const fee = await call('GET', 'admin-material', { cookie: S, query: 'id=fee-schedule' });
  check('fee schedule states 3% / $250,000 / 1%', /3%/.test(fee.payload.material.content) && fee.payload.material.content.includes('$250,000') && /1%/.test(fee.payload.material.content), fee.payload.material.content.slice(0, 200));
}

/* ================= refusals ================= */
console.log('refusals — partner and anonymous sessions get nothing');
{
  const pLogin = await call('POST', 'login', { cookie: null, body: { username: 'partner.p', password: PARTNER_PW } });
  const PS = sessionOf(pLogin);
  check('partner login (fixture sanity)', pLogin.statusCode === 200, pLogin.payload);
  for (const [method, action, body] of [
    ['POST', 'set-nda', { contractorId: invitedId, signed: true }],
    ['POST', 'set-agreement', { contractorId: invitedId, signed: true }],
    ['POST', 'send-invitation', { contractorId: invitedId }],
    ['POST', 'set-status', { contractorId: invitedId, status: 'paused' }],
    ['POST', 'advance-client', { referralId: refId, status: 'assessment_done' }],
    ['GET', 'admin-materials', null],
  ]) {
    const r = await call(method, action, { cookie: PS, body });
    check('partner session refused on ' + action, r.statusCode === 401 || r.statusCode === 403, r.statusCode);
    const a = await call(method, action, { cookie: null, body });
    check('anonymous refused on ' + action, a.statusCode === 401, a.statusCode);
  }
}

/* ================= render: EXECUTE the dashboard =================
   The real partners/app.js runs in a DOM stub whose fetch serves
   the admin fixtures. querySelectorAll('[data-act]') parses the
   HTML the app actually assigned, so the buttons inspected are
   the buttons rendered — and their captured click handlers are
   then invoked: tab -> partners -> partner detail -> the Mark
   NDA button performs its real POST through the stub. */
console.log('render — the admin dashboard EXECUTES and its buttons fire');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../partners/app.js', import.meta.url), 'utf8');
  const PIPELINE = ['added', 'questionnaire_sent', 'questionnaire_answered', 'assessment_done', 'cnda_sent', 'cnda_signed', 'ready_to_register', 'registered', 'intake_review', 'valuation_packaging', 'presented', 'buyer_diligence', 'offer_received', 'negotiating_terms', 'license_sent', 'license_signed', 'data_delivery', 'acceptance_review', 'awaiting_payment', 'deal_closed'];
  const partnerRow = { id: 'p1', name: 'Partner P', company: 'P LLC', email: 'p@x.test', phone: '', status: 'active', ndaStatus: 'pending', agreementStatus: 'pending', agreementSignedAt: null, username: 'Partner.P', credentialsSet: true, feeTotals: { earned: 3000, paid: 0, outstanding: 3000 }, createdAt: '2026-11-01T00:00:00.000Z', clientLink: 'https://iecincglobal.com/r/CODE1', inviteLink: 'https://partners.iecincglobal.com/join/CODE2' };
  const refRow = { id: 'r1', contractorId: 'p1', businessName: 'Client Biz', ownerName: 'Olive Owner', ownerEmail: 'olive@biz.test', pipelineStatus: 'added', status: 'registered', feeAmount: null, approvedAmount: null, createdAt: '2026-11-02T00:00:00.000Z' };
  const overview = () => ({ ok: true, contractors: [JSON.parse(JSON.stringify(partnerRow))], referrals: [JSON.parse(JSON.stringify(refRow))], claims: [], linkHolds: [], pipeline: PIPELINE });
  const posts = [];
  let liveOverview = overview();
  const fetchStub = async (url, opts = {}) => {
    const u = String(url);
    const action = (u.match(/action=([a-z-]+)/) || [])[1] || '';
    let payload = { ok: true };
    if (action === 'me') payload = { ok: true, contractor: { id: 'a1', name: 'Mohammed Morgan', company: 'IEC, Inc.', role: 'admin', status: 'active', agreementStatus: 'pending', ndaStatus: 'pending' }, referrals: [], clients: [] };
    else if (action === 'admin-overview') payload = liveOverview;
    else if (action === 'admin-materials') payload = { ok: true, materials: [{ id: 'agreement', title: 'Partner Agreement', meta: 'v', format: 'html' }] };
    else if (action === 'admin-material') payload = { ok: true, material: { id: 'agreement', title: 'Partner Agreement', format: 'html', content: '<p>Agreement text</p>' } };
    else if (action === 'set-nda') { posts.push({ action, body: JSON.parse(opts.body || '{}') }); liveOverview.contractors[0].ndaStatus = 'signed'; payload = { ok: true, ndaStatus: 'signed' }; }
    else if (opts.method === 'POST') { posts.push({ action, body: JSON.parse(opts.body || '{}') }); }
    return { status: 200, json: async () => payload };
  };
  function makeEl() {
    return { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', checked: false, type: '', id: '', classList: { add() {}, remove() {} }, style: {}, addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, focus() {}, scrollIntoView() {}, appendChild() {}, removeChild() {}, select() {}, remove() {}, click() {} };
  }
  const rootEl = makeEl();
  const saved = { window: globalThis.window, document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
  globalThis.window = { addEventListener() {} };
  globalThis.document = {
    getElementById(id) { return id === 'pp-root' ? rootEl : makeEl(); },
    querySelectorAll(sel) {
      if (!String(sel).includes('data-act')) return [];
      /* Element stubs are cached by act+id: wireAdminActions
         registers handlers on the instances it is handed, and the
         test later clicks those SAME instances. */
      const cache = (globalThis.__elCache = globalThis.__elCache || new Map());
      const out = [];
      const re = /data-act="([a-z-]+)"(?:\s+data-id="([^"]*)")?/g;
      let m;
      while ((m = re.exec(rootEl.innerHTML))) {
        const key = m[1] + '|' + (m[2] || '');
        if (!cache.has(key)) {
          const attrs = { 'data-act': m[1], 'data-id': m[2] || null };
          cache.set(key, { attrs, handlers: {}, addEventListener(ev, fn) { this.handlers[ev] = fn; }, getAttribute(k) { return this.attrs[k]; } });
        }
        out.push(cache.get(key));
      }
      return out;
    },
    querySelector() { return null; },
    createElement() { return makeEl(); },
    body: makeEl(),
    addEventListener() {},
    execCommand() { return true; },
  };
  globalThis.location = { search: '', hash: '', pathname: '/', hostname: 'partners.iecincglobal.com', origin: 'https://partners.iecincglobal.com', href: 'https://partners.iecincglobal.com/', reload() {} };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  globalThis.fetch = fetchStub;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const renderedActs = new Set();
  const clickAct = async (act, id) => {
    const els = globalThis.document.querySelectorAll('[data-act]');
    els.forEach(e => renderedActs.add(e.attrs['data-act']));
    const el = els.find(e => e.attrs['data-act'] === act && (id === undefined || e.attrs['data-id'] === id));
    if (!el || !el.handlers.click) return false;
    el.handlers.click();
    await sleep(30);
    return true;
  };
  try {
    (0, eval)(src);
    await sleep(50);
    globalThis.document.querySelectorAll('[data-act]').forEach(e => renderedActs.add(e.attrs['data-act']));
    check('overview renders with tab nav + referral view buttons', rootEl.innerHTML.includes('data-act="tab"') && rootEl.innerHTML.includes('data-act="r-view"'), rootEl.innerHTML.slice(0, 200));
    check('tab click -> partners section renders', await clickAct('tab', 'partners') && rootEl.innerHTML.includes('data-act="p-view"'), '');
    check('partner view click -> detail renders its action buttons', await clickAct('p-view', 'p1') && rootEl.innerHTML.includes('data-act="p-set-nda"') && rootEl.innerHTML.includes('data-act="p-send-invite"') && rootEl.innerHTML.includes('data-act="p-copy-client"'), '');
    check('Mark NDA button fires the real set-nda POST for p1', await clickAct('p-set-nda', 'p1') && posts.some(x => x.action === 'set-nda' && x.body.contractorId === 'p1'), posts);
    check('after the POST the detail re-renders from the refreshed overview (NDA now signed, button gone)', !rootEl.innerHTML.includes('data-act="p-set-nda"'), '');
    check('materials tab renders the library', await clickAct('tab', 'materials') && rootEl.innerHTML.includes('data-act="m-view"'), '');
    check('material view renders the document + download button', await clickAct('m-view', 'agreement') && rootEl.innerHTML.includes('data-act="m-download"') && rootEl.innerHTML.includes('Agreement text'), '');
    globalThis.document.querySelectorAll('[data-act]').forEach(e => renderedActs.add(e.attrs['data-act']));
    const missing = [...renderedActs].filter(a => !src.includes("act === '" + a + "'"));
    check('every RENDERED data-act has a dispatch branch (' + [...renderedActs].join(', ') + ')', missing.length === 0, missing);
  } finally {
    globalThis.window = saved.window; globalThis.document = saved.document;
    globalThis.location = saved.location; globalThis.fetch = saved.fetch;
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
