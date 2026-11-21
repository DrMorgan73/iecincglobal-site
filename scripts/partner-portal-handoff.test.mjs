/* Standalone Partner Portal — hand-off regression + hold ruling
   suite (Nov 21, 2026). Covers the verified production defect
   and its designed correction:

   1. THE HAND-OFF: the legacy client landing navigated from the
      /r/<code> address with a RELATIVE questionnaire URL, which
      resolved back into the /r/:code rewrite and destroyed the
      registration. This suite reproduces that resolution against
      the site's real vercel.json rewrites (the control — it must
      land on the wrong page), then proves the standalone
      portal's register page hands off with an ABSOLUTE URL that
      reaches the portal's questionnaire page on the main host,
      the ES twin, and the portal host.
   2. THE HOLD FLOW through the real submit path, with the
      payload shaped exactly as partners/questionnaire.js builds
      it: paused and revoked partners' submissions are ACCEPTED
      as flagged Desk holds (reason recorded), never credited,
      partner's clients/fees unchanged; the active control
      credits normally.
   3. THE DESK RULING (resolve-hold): credit only while the
      partner is active and the business still unregistered;
      dismiss removes; nothing is automatic.
   4. The portal-form client link in `me` + the QR endpoint's
      form=portal variant, and the static contract checks (Desk
      stage map + controls, app.js API contract, segments data).

   Same mocked-Neon + Blob-hooks harness as partner-link.test.
   Run: node scripts/partner-portal-handoff.test.mjs            */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';

register('./testing/blob-hooks.mjs', import.meta.url);

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'https://neon-sql.test/sql';
process.env.QUESTIONNAIRE_DATABASE_URL = 'https://neon-sql.test/sql';
process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';
delete process.env.DEMO_ADMIN_RESEND_API_KEY;
delete process.env.PARTNER_PORTAL_PUBLIC_URL;
delete process.env.CONTRACTOR_PORTAL_BASE_URL;

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
async function submit(body) {
  const req = { method: 'POST', url: '/api/questionnaire-submit', headers: {}, body };
  const res = mockRes();
  await submitHandler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

/* ================= 1. the hand-off (URL resolution) ================= */
console.log('hand-off URL resolution (the link defect regression)');
{
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const rewrites = vercel.rewrites || [];
  const toRe = (src) => new RegExp('^' + src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z]+)/g, '([^/]+)') + '$');
  /* Walk a URL through the rewrite table the way Vercel does:
     first matching rule wins; host-conditioned rules apply only
     on their host. Returns the destination path (or the input
     path when no rule matches — the static file itself). */
  function applyRewrites(urlStr) {
    const u = new URL(urlStr);
    for (const r of rewrites) {
      const hostCond = (r.has || []).find(h => h.type === 'host');
      if (hostCond && hostCond.value !== u.hostname) continue;
      const m = u.pathname.match(toRe(r.source));
      if (!m) continue;
      let dest = r.destination;
      const names = [...r.source.matchAll(/:([A-Za-z]+)/g)].map(x => x[1]);
      names.forEach((n, i) => { dest = dest.replace(':' + n, m[i + 1]); });
      return dest;
    }
    return u.pathname;
  }
  const registerSrc = await readFile(new URL('../partners/register.js', import.meta.url), 'utf8');
  const questionnaireSrc = await readFile(new URL('../partners/questionnaire.js', import.meta.url), 'utf8');

  check('register.js hands off with an ABSOLUTE portal URL',
    registerSrc.includes("PREFIX + '/partners/questionnaire.html?segment='"));
  check('register.js contains no relative questionnaire navigation',
    !/location\.href\s*=\s*"questionnaire/.test(registerSrc) && !registerSrc.includes('questionnaire-form.html'));
  check('register.js stores the shared profile shape (iecPartnerLinkProfile)',
    registerSrc.includes("sessionStorage.setItem('iecPartnerLinkProfile'"));
  check('questionnaire.js bounces to the ABSOLUTE register route when the profile is missing',
    questionnaireSrc.includes("PREFIX + '/partners/r/'"));

  /* The control — the OLD relative hand-off from the /r/<code>
     address bar, exactly as the legacy landing produced it. It
     MUST land on the wrong page (that is the defect). */
  const pageUrl = 'https://iecincglobal.com/r/JKDW5CZK';
  const oldRel = 'questionnaire-form.html?segment=pharmacy&partner=JKDW5CZK';
  const oldResolved = new URL(oldRel, pageUrl);
  check('control: the old relative URL resolves back under /r/ (the defect)',
    oldResolved.pathname === '/r/questionnaire-form.html', oldResolved.pathname);
  const oldDest = applyRewrites(oldResolved.href);
  check('control: the rewrite table sends it to the landing, NOT the questionnaire (registration lost)',
    oldDest.startsWith('/partner-link.html'), oldDest);

  /* The new hand-off, on the main host (preview route). */
  const newUrl = new URL("/partners/questionnaire.html?segment=pharmacy&partner=JKDW5CZK", pageUrl);
  check('new hand-off resolves to the portal questionnaire path',
    newUrl.pathname === '/partners/questionnaire.html', newUrl.pathname);
  check('no rewrite diverts the portal questionnaire path',
    applyRewrites(newUrl.href) === '/partners/questionnaire.html');

  /* The ES twin. */
  const esPage = 'https://iecincglobal.com/es/partners/r/JKDW5CZK';
  const esUrl = new URL("/es/partners/questionnaire.html?segment=pharmacy&partner=JKDW5CZK", esPage);
  check('ES hand-off resolves to the ES questionnaire path',
    esUrl.pathname === '/es/partners/questionnaire.html' &&
    applyRewrites(esUrl.href) === '/es/partners/questionnaire.html');

  /* The portal host: register page served at /r/<code>; the
     hand-off path and the questionnaire's bounce-back both work. */
  const hostPage = 'https://partners.iecincglobal.com/r/JKDW5CZK';
  check('portal host: /r/<code> rewrites to the portal register page',
    applyRewrites(hostPage) === '/partners/register.html?code=JKDW5CZK', applyRewrites(hostPage));
  const hostQ = new URL('/partners/questionnaire.html?segment=pharmacy&partner=JKDW5CZK', hostPage);
  check('portal host: questionnaire path serves directly',
    applyRewrites(hostQ.href) === '/partners/questionnaire.html');
  const bounce = new URL('/partners/r/JKDW5CZK', hostPage);
  check('portal host: the questionnaire bounce target rewrites to the register page',
    applyRewrites(bounce.href) === '/partners/register.html?code=JKDW5CZK', applyRewrites(bounce.href));

  /* The rewrite ordering that makes the portal host work: the
     host-conditioned /r/:code rule precedes the legacy one. */
  const hostIdx = rewrites.findIndex(r => r.source === '/r/:code' && (r.has || []).some(h => h.type === 'host'));
  const legacyIdx = rewrites.findIndex(r => r.source === '/r/:code' && !r.has);
  check('host /r/:code rule precedes the legacy /r/:code rule', hostIdx >= 0 && legacyIdx > hostIdx);
  check('preview routes exist for /partners/r/:code and /es/partners/r/:code',
    rewrites.some(r => r.source === '/partners/r/:code' && !r.has) &&
    rewrites.some(r => r.source === '/es/partners/r/:code' && !r.has));
}

/* ================= seed partners ================= */
async function seedPartner(email, name, status) {
  const id = crypto.randomUUID();
  await storeMod.createContractor({ id, email, name, company: name + ' LLC', activationTokenHash: '' });
  await storeMod.updateContractor(id, { status, ndaStatus: 'signed', agreementStatus: 'signed' });
  const code = await storeMod.ensureContractorClientCode(id);
  return { id, code };
}
const active = await seedPartner('hand-active@example.com', 'Hand Active', 'active');
const paused = await seedPartner('hand-paused@example.com', 'Hand Paused', 'paused');
const revoked = await seedPartner('hand-revoked@example.com', 'Hand Revoked', 'revoked');
check('seeded partners hold client codes', !!(active.code && paused.code && revoked.code));

/* The submit payload, shaped EXACTLY as partners/questionnaire.js
   builds it (segment, contact, answers, partnerCode,
   partnerProfile from the stored landing profile). */
function portalSubmit(code, business, email) {
  return {
    segment: 'pharmacy',
    contact: { name: 'Olivia Owner', business, email, phone: '' },
    answers: { 'Q1. How many locations do you operate?': '2' },
    company_website: '',
    partnerCode: code,
    partnerProfile: { businessName: business, city: 'Boston', state: 'MA' }
  };
}

/* ================= 2. the hold flow (real submit path) ================= */
console.log('hold flow — paused / revoked / active');
{
  const resP = await submit(portalSubmit(paused.code, 'Held Bakery LLC', 'held-bakery@example.com'));
  check('paused partner link submission is ACCEPTED (200)', resP.statusCode === 200 && resP.payload.ok, resP.payload);
  check('paused submission reports attribution held',
    resP.payload.attribution && resP.payload.attribution.status === 'held', resP.payload.attribution);
  let holds = await storeMod.listLinkHolds();
  check('a Desk hold exists for the paused submission',
    holds.length === 1 && holds[0].businessName === 'Held Bakery LLC', holds.map(h => h.businessName));
  check('the hold carries the reason (partner status)',
    holds[0] && holds[0].reason === 'paused', holds[0] && holds[0].reason);
  check('the hold carries the questionnaire submission reference',
    !!(holds[0] && holds[0].questionnaireSubmissionId));
  const pRefs = await storeMod.listReferralsByContractor(paused.id);
  check("paused partner's clients are unchanged (no referral)", pRefs.length === 0);
  const meP = await call('GET', 'me', { cookie: partnerCookie(paused.id) });
  check("paused partner's portal shows no client and no fees from the hold",
    meP.payload.clients.length === 0 && meP.payload.feeTotals.earned === 0, meP.payload.feeTotals);

  const resR = await submit(portalSubmit(revoked.code, 'Revoked Link Biz LLC', 'revoked-biz@example.com'));
  check('revoked partner link submission is ACCEPTED (200)', resR.statusCode === 200 && resR.payload.ok, resR.payload);
  check('revoked submission reports attribution held',
    resR.payload.attribution && resR.payload.attribution.status === 'held');
  holds = await storeMod.listLinkHolds();
  const rHold = holds.find(h => h.businessName === 'Revoked Link Biz LLC');
  check('a Desk hold exists for the revoked submission with reason revoked',
    !!rHold && rHold.reason === 'revoked', rHold && rHold.reason);
  const rRefs = await storeMod.listReferralsByContractor(revoked.id);
  check("revoked partner's clients are unchanged (no referral)", rRefs.length === 0);

  const resA = await submit(portalSubmit(active.code, 'Active Link Pharmacy LLC', 'active-pharm@example.com'));
  check('active partner link submission credits normally',
    resA.statusCode === 200 && resA.payload.attribution && resA.payload.attribution.status === 'credited', resA.payload);
  const aRefs = await storeMod.listReferralsByContractor(active.id);
  check('active partner holds the referral at questionnaire_answered via the link',
    aRefs.length === 1 && aRefs[0].pipelineStatus === 'questionnaire_answered' && aRefs[0].source === 'link',
    aRefs.map(r => [r.pipelineStatus, r.source]));
}

/* ================= 3. the Desk ruling (resolve-hold) ================= */
console.log('resolve-hold — the Desk ruling');
{
  const holds = await storeMod.listLinkHolds();
  const pHold = holds.find(h => h.businessName === 'Held Bakery LLC');
  const rHold = holds.find(h => h.businessName === 'Revoked Link Biz LLC');
  const desk = deskCookie();

  const early = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: pHold.id, decision: 'credit' } });
  check('credit refused while the partner is still paused (409 partner_not_active)',
    early.statusCode === 409 && early.payload.error === 'partner_not_active', early.payload);
  check('the refused credit leaves the hold in place',
    (await storeMod.listLinkHolds()).some(h => h.id === pHold.id));

  const unpause = await call('POST', 'set-status', { cookie: desk, body: { contractorId: paused.id, status: 'active' } });
  check('Desk resumes the paused partner (the documented exception)',
    unpause.statusCode === 200 && unpause.payload.ok, unpause.payload);

  const credited = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: pHold.id, decision: 'credit' } });
  check('credit succeeds once the partner is active', credited.statusCode === 200 && credited.payload.ok, credited.payload);
  const pRefs = await storeMod.listReferralsByContractor(paused.id);
  check('the credited hold becomes the partner\u2019s referral at questionnaire_answered via the link',
    pRefs.length === 1 && pRefs[0].pipelineStatus === 'questionnaire_answered' && pRefs[0].source === 'link',
    pRefs.map(r => [r.pipelineStatus, r.source]));
  check('the credited hold is gone from the board',
    !(await storeMod.listLinkHolds()).some(h => h.id === pHold.id));
  const again = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: pHold.id, decision: 'credit' } });
  check('re-ruling a resolved hold answers 404', again.statusCode === 404, again.statusCode);

  /* Duplicate-on-credit: the revoked partner's held business is
     the one just credited under the paused partner? No — a
     different business: register 'Revoked Link Biz LLC' is still
     unregistered. Register it under the ACTIVE partner first
     (direct add), then try to credit the revoked hold. */
  const reg = await call('POST', 'register-referral', {
    cookie: partnerCookie(active.id),
    body: { businessName: 'Revoked Link Biz LLC', ownerName: 'Olivia Owner', ownerEmail: 'other@example.com', industry: 'pharmacy' }
  });
  check('control registration of the held business elsewhere succeeds', reg.statusCode === 200, reg.payload);
  await storeMod.updateContractor(revoked.id, { status: 'active' });
  const dupCredit = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: rHold.id, decision: 'credit' } });
  check('credit refused when the business has since registered (409 already_registered), hold kept',
    dupCredit.statusCode === 409 && dupCredit.payload.error === 'already_registered' &&
    (await storeMod.listLinkHolds()).some(h => h.id === rHold.id), dupCredit.payload);
  const dismissed = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: rHold.id, decision: 'dismiss' } });
  check('dismiss removes the hold', dismissed.statusCode === 200 && dismissed.payload.ok, dismissed.payload);
  check('the dismissed hold created no referral',
    (await storeMod.listReferralsByContractor(revoked.id)).length === 0 &&
    !(await storeMod.listLinkHolds()).some(h => h.id === rHold.id));
  const badDecision = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: 'missing', decision: 'credit' } });
  check('an unknown hold answers 404', badDecision.statusCode === 404);
  const noDesk = await call('POST', 'resolve-hold', { cookie: partnerCookie(active.id), body: { holdId: 'x', decision: 'dismiss' } });
  check('resolve-hold is Desk-only (partner session refused)', noDesk.statusCode === 401, noDesk.statusCode);
}

/* ================= 4. portal-form link + QR variant ================= */
console.log('portal-form client link');
{
  const me = await call('GET', 'me', { cookie: partnerCookie(active.id) });
  check('me carries the standalone portal-form client link',
    me.payload.portalClientLink === `https://partners.iecincglobal.com/r/${active.code}`, me.payload.portalClientLink);
  check('me still carries the legacy client link unchanged',
    me.payload.clientLink === `https://iecincglobal.com/r/${active.code}`, me.payload.clientLink);
  check('the portal email template carries the portal-form link',
    !!(me.payload.portalClientLinkEmail && me.payload.portalClientLinkEmail.body.includes(me.payload.portalClientLink)));
  const qrDefault = await call('GET', 'client-link-qr', { cookie: partnerCookie(active.id) });
  const qrPortal = await call('GET', 'client-link-qr', { cookie: partnerCookie(active.id), query: 'form=portal' });
  check('QR endpoint serves an SVG', typeof qrDefault.payload === 'string' && qrDefault.payload.startsWith('<svg'));
  check('QR form=portal encodes the portal-form link (different code)',
    typeof qrPortal.payload === 'string' && qrPortal.payload.startsWith('<svg') && qrPortal.payload !== qrDefault.payload);
}

/* ================= 5. static contract checks ================= */
console.log('static contract checks');
{
  const desk = await readFile(new URL('../desk/contractors-admin.html', import.meta.url), 'utf8');
  const stages = ['added', 'questionnaire_sent', 'questionnaire_answered', 'assessment_done', 'cnda_sent', 'cnda_signed',
    'ready_to_register', 'registered', 'intake_review', 'valuation_packaging', 'presented', 'buyer_diligence',
    'offer_received', 'negotiating_terms', 'license_sent', 'license_signed', 'data_delivery', 'acceptance_review',
    'awaiting_payment', 'deal_closed'];
  check('Desk stage labels cover all 20 pipeline stages',
    stages.every(s => desk.includes(`${s}: '`)) || stages.every(s => desk.includes(s)));
  check('Desk carries the approved-amount controls', desk.includes('data-approved') && desk.includes('set-approved-amount'));
  check('Desk carries the hold ruling controls', desk.includes('data-hold-credit') && desk.includes('data-hold-dismiss') && desk.includes('resolve-hold'));

  const app = await readFile(new URL('../partners/app.js', import.meta.url), 'utf8');
  check('app.js calls the API with the action in the query string (the API contract)',
    app.includes("/api/contractors?action=' + encodeURIComponent(action)"));
  check('app.js resolves invites through the GET endpoint and reads `partner`',
    app.includes("action: 'resolve-invite'") && app.includes("'GET'") && app.includes('res.body.partner'));
  check('app.js uploads the W-9 under the API field name (dataBase64)', app.includes('dataBase64: b64'));
  check('app.js fetches the portal-form QR', app.includes('client-link-qr&form=portal'));
  check('app.js presents the standalone link form', app.includes("'/partners/r/'"));

  globalThis.window = {};
  await import('../partners/segments-data.js');
  const segs = globalThis.window.IEC_SEGMENTS;
  check('segments data carries all seven segments',
    !!segs && ['pharmacy', 'home-health', 'pt', 'medical-practice', 'gas-convenience', 'general-business', 'nonprofit']
      .every(s => segs[s] && Array.isArray(segs[s].sections) && segs[s].sections.length > 0),
    segs && Object.keys(segs));
  const totalFields = Object.values(segs || {}).reduce((n, s) => n + s.sections.reduce((m, x) => m + x.fields.length, 0), 0);
  check('segments data carries the full field sets (130+ fields)', totalFields >= 130, totalFields);
  check('nonprofit shares the general-business field set exactly',
    JSON.stringify(segs['general-business'].sections) === JSON.stringify(segs.nonprofit.sections));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
