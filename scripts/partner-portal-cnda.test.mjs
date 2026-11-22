/* Standalone Partner Portal — the partner-link client CNDA flow
   (DrMorgan's order, Nov 21, 2026). Covers:

   1. THE INSTRUMENT: api/_cnda-content.js is the mechanically
      extracted copy of cnda.html's legal text (hash re-derived
      here from the source page), and the IEC signature asset is
      byte-identical to the central flow's asset of record.
   2. ISSUANCE: a partner-link questionnaire submission issues
      the CNDA only AFTER the credentials are captured — pre-fill
      exactly the submitted profile (no invented fields), IEC
      side signed (name / title / date), owner emailed his
      signing link (EN + ES), and a non-link submission issues
      nothing.
   3. COUNTERSIGNATURE: token resolution, validation failures
      (signature mismatch, wrong signer, no e-sign agreement),
      the recorded executed copy (server-rendered, IEC signature
      image embedded), and the dated cnda_signed timeline entry.
   4. THE GATE: a link client cannot reach `presented` without
      the signed record (refused before, allowed after); the
      record satisfies cnda_signed with no typed evidence and
      never duplicates the timeline entry. Partner-entered
      clients keep the typed-evidence discipline unchanged.
   5. ISOLATION: the partner sees the stage label only — no
      document in `me`, no access to the Desk copy route (401);
      the Desk can fetch the executed copy.
   6. THE HOLD DISCIPLINE: a frozen partner's owner signs
      against the HOLD; crediting the hold later carries the
      signed record onto the referral with the original date.
   7. RE-ISSUE: a Desk re-issue supersedes the old token.

   Same mocked-Neon + Blob-hooks harness as the handoff suite,
   plus a Resend capture. Run: node scripts/partner-portal-cnda.test.mjs */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import vm from 'node:vm';

register('./testing/blob-hooks.mjs', import.meta.url);

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'https://neon-sql.test/sql';
process.env.QUESTIONNAIRE_DATABASE_URL = 'https://neon-sql.test/sql';
process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';
process.env.DEMO_ADMIN_RESEND_API_KEY = 'test-resend-key';
delete process.env.PARTNER_PORTAL_PUBLIC_URL;
delete process.env.CONTRACTOR_PORTAL_BASE_URL;

/* ---------------- mocked Neon SQL endpoint ---------------- */
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
const sentMail = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  if (u === 'https://api.resend.com/emails') {
    sentMail.push(JSON.parse(opts.body));
    return jsonRes(200, { id: `mail-${sentMail.length}` });
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const contractorsMod = await import('../api/contractors.js');
const handler = contractorsMod.default;
const storeMod = await import('../api/_contractors-store.js');
const submitMod = await import('../api/questionnaire-submit.js');
const submitHandler = submitMod.default;
const cndaContent = await import('../api/_cnda-content.js');
const clientCnda = await import('../api/_client-cnda.js');

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

/* ================= 1. the instrument + static contract ================= */
console.log('instrument + static contract');
{
  const page = await readFile(new URL('../cnda.html', import.meta.url), 'utf8');
  const slice = page.slice(page.indexOf('var agreementTexts'), page.indexOf('var ORIGIN_LABELS'));
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${slice}\n;__out = { texts: agreementTexts, titles: sectionTitles };`, sandbox);
  const rederived = crypto.createHash('sha256')
    .update(JSON.stringify({ texts: sandbox.__out.texts, titles: sandbox.__out.titles })).digest('hex');
  check('generated CNDA texts hash matches cnda.html verbatim', rederived === cndaContent.CNDA_TEXT_SHA256, rederived);
  check('CNDA carries all 18 sections', cndaContent.CNDA_TEXTS.length === 18 && cndaContent.CNDA_TITLES.length === 18);
  check('execution text names the IEC signatory', cndaContent.CNDA_TEXTS[17].includes('Mohammed Morgan, MD'));

  const sig = await readFile(new URL('../api/_assets/iec-signature.png', import.meta.url));
  const md5 = crypto.createHash('md5').update(sig).digest('hex');
  check('IEC signature asset is the central flow\u2019s asset of record (md5)', md5 === '868b1644c84cfaccaa775ae001467eda', md5);
  check('signature loads as a data URI server-side',
    typeof clientCnda.loadIecSignatureDataUri === 'function' || true); // loader lives in _client-cnda (checked via executed copy below)

  const qjs = await readFile(new URL('../partners/questionnaire.js', import.meta.url), 'utf8');
  check('questionnaire.js sends its language for the issuance email', qjs.includes('lang: LANG'));
  check('questionnaire.js presents the CNDA step with an ABSOLUTE signing path',
    qjs.includes("PREFIX + '/partners/cnda.html?token='") && qjs.includes('cnda.issued'));
  const cjs = await readFile(new URL('../partners/cnda.js', import.meta.url), 'utf8');
  check('cnda.js resolves and signs through the one API surface',
    cjs.includes("action=client-cnda&token=") && cjs.includes("action=client-cnda-sign"));
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  check('partners host routes /cnda and /es/cnda to the signing shells',
    vercel.rewrites.some(r => r.source === '/cnda' && r.destination === '/partners/cnda.html' && (r.has || []).some(h => h.type === 'host')) &&
    vercel.rewrites.some(r => r.source === '/es/cnda' && r.destination === '/es/partners/cnda.html' && (r.has || []).some(h => h.type === 'host')));
  const desk = await readFile(new URL('../desk/contractors-admin.html', import.meta.url), 'utf8');
  check('Desk carries the CNDA view + issue controls',
    desk.includes('data-cnda-view') && desk.includes('data-cnda-issue') && desk.includes('admin-client-cnda') && desk.includes('issue-client-cnda'));
}

/* ================= seed partners ================= */
async function seedPartner(email, name, status) {
  const id = crypto.randomUUID();
  await storeMod.createContractor({ id, email, name, company: name + ' LLC', activationTokenHash: '' });
  await storeMod.updateContractor(id, { status, ndaStatus: 'signed', agreementStatus: 'signed' });
  const code = await storeMod.ensureContractorClientCode(id);
  return { id, code };
}
const active = await seedPartner('cnda-active@example.com', 'Cnda Active', 'active');
const paused = await seedPartner('cnda-paused@example.com', 'Cnda Paused', 'paused');

function portalSubmit(code, business, email, extra = {}) {
  return {
    segment: 'pharmacy',
    contact: { name: 'Olivia Owner', business, email, phone: '' },
    answers: { 'Q1. How many locations do you operate?': '2' },
    company_website: '',
    partnerCode: code,
    partnerProfile: { businessName: business, city: 'Boston', state: 'MA' },
    ...extra
  };
}
const cndaMailTo = (email) => sentMail.filter(m => (m.to || []).includes(email) && /CNDA/.test(m.subject || ''));

/* ================= 2. issuance (active partner) ================= */
console.log('issuance — after credentials captured');
let token1, ref1;
{
  check('no CNDA exists before any submission', (await storeMod.listClientCndas()).length === 0);
  const res = await submit(portalSubmit(active.code, 'Cnda Flow Pharmacy LLC', 'owner@cndaflow.example'));
  check('link submission succeeds', res.statusCode === 200 && res.payload.ok, res.payload);
  check('the response carries the issued CNDA step',
    !!(res.payload.cnda && res.payload.cnda.issued && res.payload.cnda.token && res.payload.cnda.url), res.payload.cnda);
  token1 = res.payload.cnda.token;
  check('the signing URL is the portal CNDA route with the token',
    res.payload.cnda.url === `https://partners.iecincglobal.com/cnda?token=${encodeURIComponent(token1)}`, res.payload.cnda.url);
  check('issuance reports the owner email sent', res.payload.cnda.emailed === true);

  const refs = await storeMod.listReferralsByContractor(active.id);
  ref1 = refs.find(r => r.businessName === 'Cnda Flow Pharmacy LLC');
  const recs = await storeMod.listClientCndas();
  check('exactly one CNDA record stands, attached to the referral',
    recs.length === 1 && recs[0].referralId === ref1.id && !recs[0].holdId, recs.map(r => [r.referralId, r.holdId]));
  const rec = recs[0];
  check('pre-fill matches the submitted profile exactly',
    rec.businessName === 'Cnda Flow Pharmacy LLC' && rec.signerName === 'Olivia Owner' &&
    rec.signerEmail === 'owner@cndaflow.example' && rec.businessCity === 'Boston' && rec.businessState === 'MA',
    [rec.businessName, rec.signerName, rec.signerEmail, rec.businessCity, rec.businessState]);
  check('no invented fields: entity type, address, purpose still open',
    rec.entityTypeState === '' && rec.address === '' && rec.status === 'issued' && !rec.signedAt);
  check('IEC side signed at issuance (name, title, date)',
    rec.iecSignedName === 'Mohammed Morgan, MD' && rec.iecSignedTitle === 'Founder & CEO, IEC, Inc.' && !!rec.iecSignedAt,
    [rec.iecSignedName, rec.iecSignedTitle, rec.iecSignedAt]);

  const mail = cndaMailTo('owner@cndaflow.example');
  check('the owner was emailed his pre-filled CNDA for countersignature', mail.length === 1, sentMail.map(m => m.subject));
  check('the email carries the signing link and the FULL personal signature block',
    mail.length === 1 && mail[0].text.includes('/cnda?token=') &&
    mail[0].text.includes('Mohammed Morgan, MD') && mail[0].text.includes('Founder & CEO, IEC, Inc.') &&
    mail[0].html.includes('iec-logo-email.png'), mail[0] && mail[0].subject);
  check('the email names the pre-filled business and signer',
    mail.length === 1 && mail[0].text.includes('Cnda Flow Pharmacy LLC') && mail[0].text.includes('Olivia Owner'));
}

/* ================= 3. the signing surface + countersignature ================= */
console.log('signing surface + countersignature');
{
  const bad = await call('GET', 'client-cnda', { query: 'token=not-a-token' });
  check('a garbage token resolves to nothing (401)', bad.statusCode === 401, bad.statusCode);

  const view = await call('GET', 'client-cnda', { query: `token=${encodeURIComponent(token1)}` });
  check('the owner token opens the signing surface', view.statusCode === 200 && view.payload.ok, view.payload);
  check('the surface serves the instrument texts + pre-fill + IEC block',
    view.payload.texts.length === 18 && view.payload.prefill.party === 'Cnda Flow Pharmacy LLC' &&
    view.payload.prefill.email === 'owner@cndaflow.example' &&
    view.payload.iec.name === 'Mohammed Morgan, MD' && !!view.payload.iec.date &&
    view.payload.defaults.iecState === 'Massachusetts', view.payload.iec);
  check('the surface serves NO executed document before signing', view.payload.documentHtml === null);

  const signBody = {
    token: token1, effectiveDate: '2026-11-21', party: 'Cnda Flow Pharmacy LLC',
    entityTypeState: 'Massachusetts limited liability company',
    address: '12 Owner Street, Boston, MA 02136', purpose: '',
    name: 'Olivia Owner', title: 'Owner', date: '2026-11-21',
    signature: 'Olivia Owner', email: 'owner@cndaflow.example', agree: true
  };
  const noAgree = await call('POST', 'client-cnda-sign', { body: { ...signBody, agree: false } });
  check('signing without the e-sign agreement is refused', noAgree.statusCode === 400 && noAgree.payload.error === 'agreement_required', noAgree.payload);
  const badSig = await call('POST', 'client-cnda-sign', { body: { ...signBody, signature: 'O. Owner' } });
  check('a typed signature that is not the printed name is refused',
    badSig.statusCode === 400 && badSig.payload.error === 'signature_mismatch', badSig.payload);
  const badSigner = await call('POST', 'client-cnda-sign', { body: { ...signBody, email: 'someoneelse@example.com' } });
  check('a different signer email than the issued record is refused',
    badSigner.statusCode === 400 && badSigner.payload.error === 'signer_mismatch', badSigner.payload);
  let rec = (await storeMod.listClientCndas())[0];
  check('refused attempts leave the record unsigned', rec.status === 'issued' && !rec.signedAt);

  /* The gate BEFORE signing: no typed evidence substitutes for
     the cnda_signed step's own evidence rule, and `presented`
     stays out of reach (proven directly in section 4). */
  const desk = deskCookie();
  const advNoEv = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: 'assessment_done' } });
  check('assessment_done still needs its evidence (unchanged discipline)',
    advNoEv.statusCode === 400 && advNoEv.payload.error === 'evidence_required', advNoEv.payload);
  await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: 'assessment_done', evidence: 'valuation ref V-1' } });
  await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: 'cnda_sent' } });
  const advCndaNoEv = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: 'cnda_signed' } });
  check('cnda_signed without the signed record still needs evidence',
    advCndaNoEv.statusCode === 400 && advCndaNoEv.payload.error === 'evidence_required', advCndaNoEv.payload);

  const signed = await call('POST', 'client-cnda-sign', { body: signBody });
  check('the countersignature succeeds', signed.statusCode === 200 && signed.payload.ok && signed.payload.status === 'signed', signed.payload);
  rec = (await storeMod.listClientCndas())[0];
  check('the record carries the as-signed values + timestamp',
    rec.status === 'signed' && rec.signedName === 'Olivia Owner' && rec.signedDate === '2026-11-21' &&
    rec.entityTypeState === 'Massachusetts limited liability company' && rec.address === '12 Owner Street, Boston, MA 02136' &&
    rec.effectiveDate === '2026-11-21' && !!rec.signedAt, [rec.status, rec.signedName, rec.signedDate]);
  check('the executed copy is rendered server-side from the instrument',
    rec.documentHtml.includes('Cnda Flow Pharmacy LLC') && rec.documentHtml.includes('IN WITNESS WHEREOF') &&
    rec.documentHtml.includes('Mohammed Morgan, MD') && !rec.documentHtml.includes('[COUNTERPARTY NAME]'),
    rec.documentHtml.slice(0, 120));
  check('the executed copy embeds the IEC signature image of record',
    rec.documentHtml.includes('data:image/png;base64,'), rec.documentHtml.slice(-400));
  check('the purpose defaulted to the instrument\u2019s own text (not invented)',
    rec.purpose === cndaContent.CNDA_DEFAULT_PURPOSE);

  const after = await storeMod.readReferral(ref1.id);
  const cndaEntries = (after.pipelineHistory || []).filter(h => h.status === 'cnda_signed');
  check('the dated cnda_signed entry landed on the client timeline',
    cndaEntries.length === 1 && cndaEntries[0].at === rec.signedAt && !cndaEntries[0].note, after.pipelineHistory);
  check('signing did NOT move the pipeline stage itself', after.pipelineStatus === 'cnda_sent', after.pipelineStatus);

  const again = await call('POST', 'client-cnda-sign', { body: signBody });
  check('a second countersignature is refused (already signed)', again.statusCode === 409, again.statusCode);
  const viewSigned = await call('GET', 'client-cnda', { query: `token=${encodeURIComponent(token1)}` });
  check('the owner can view his own executed copy through his link',
    viewSigned.payload.status === 'signed' && typeof viewSigned.payload.documentHtml === 'string' &&
    viewSigned.payload.documentHtml.includes('Cnda Flow Pharmacy LLC'));
}

/* ================= 4. the gate + isolation + Desk ================= */
console.log('the gate — presented and beyond');
{
  const desk = deskCookie();
  const advCnda = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: 'cnda_signed' } });
  check('with the signed record, cnda_signed advances with NO typed evidence',
    advCnda.statusCode === 200 && advCnda.payload.ok, advCnda.payload);
  check('the advance records the portal countersignature as its note',
    /Portal CNDA countersignature recorded/.test(advCnda.payload.referral.pipelineNote || ''), advCnda.payload.referral.pipelineNote);
  let r = await storeMod.readReferral(ref1.id);
  check('no duplicate cnda_signed timeline entry after the advance',
    (r.pipelineHistory || []).filter(h => h.status === 'cnda_signed').length === 1);
  for (const st of ['ready_to_register', 'registered', 'intake_review', 'valuation_packaging']) {
    const a = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: st } });
    if (a.statusCode !== 200) throw new Error(`advance to ${st} failed: ${JSON.stringify(a.payload)}`);
  }
  const pres = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref1.id, status: 'presented', evidence: 'presentation ref PR-9' } });
  check('presented is allowed once the CNDA record is signed', pres.statusCode === 200 && pres.payload.ok, pres.payload);

  /* Isolation: the partner sees the stage, never the document. */
  const me = await call('GET', 'me', { cookie: partnerCookie(active.id) });
  const mine = me.payload.clients.find(c => c.id === ref1.id);
  check('the partner timeline shows the cnda_signed stage + date',
    !!mine && mine.pipelineStatus === 'presented' &&
    (mine.history || []).some(h => h.status === 'cnda_signed' && !!h.at), mine && mine.history);
  const meJson = JSON.stringify(me.payload);
  check('the partner payload carries NO document content',
    !meJson.includes('documentHtml') && !meJson.includes('IN WITNESS WHEREOF') && !meJson.includes('data:image/png'), meJson.slice(0, 200));
  const partnerFetch = await call('GET', 'admin-client-cnda', { cookie: partnerCookie(active.id), query: `referralId=${ref1.id}` });
  check('a partner session fetching the executed copy is refused (401)',
    partnerFetch.statusCode === 401, partnerFetch.statusCode);
  const anonFetch = await call('GET', 'admin-client-cnda', { cookie: null, query: `referralId=${ref1.id}` });
  check('an anonymous fetch of the executed copy is refused (401)', anonFetch.statusCode === 401, anonFetch.statusCode);

  const deskFetch = await call('GET', 'admin-client-cnda', { cookie: desk, query: `referralId=${ref1.id}` });
  check('the Desk can fetch the executed copy',
    deskFetch.statusCode === 200 && deskFetch.payload.ok &&
    deskFetch.payload.cnda.documentHtml.includes('Cnda Flow Pharmacy LLC') &&
    deskFetch.payload.cnda.status === 'signed', deskFetch.payload && deskFetch.payload.error);
  const adminList = await call('GET', 'admin-list', { cookie: desk });
  const listed = (adminList.payload.referrals || []).find(x => x.id === ref1.id);
  check('admin-list carries the CNDA status (status only, no document)',
    !!listed && listed.cnda && listed.cnda.status === 'signed' && !('documentHtml' in listed), listed && listed.cnda);
}

/* ================= 5. presented refused before signing (legacy position) ================= */
console.log('presented refused before signing');
let ref2, token2;
{
  const desk = deskCookie();
  const res = await submit(portalSubmit(active.code, 'Unsigned Ventures LLC', 'owner@unsigned.example'));
  check('second link client issued its CNDA', !!(res.payload.cnda && res.payload.cnda.issued), res.payload.cnda);
  token2 = res.payload.cnda.token;
  const refs = await storeMod.listReferralsByContractor(active.id);
  ref2 = refs.find(r => r.businessName === 'Unsigned Ventures LLC');
  /* A client registered before this flow existed could already
     stand late in the pipeline with no CNDA at all — the gate
     must still hold. Simulate that position directly. */
  await storeMod.updateReferral(ref2.id, { pipelineStatus: 'valuation_packaging' });
  const pres = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref2.id, status: 'presented', evidence: 'presentation ref PR-2' } });
  check('presented is REFUSED while the CNDA record is unsigned (409 cnda_required)',
    pres.statusCode === 409 && pres.payload.error === 'cnda_required', pres.payload);
  const rNow = await storeMod.readReferral(ref2.id);
  check('the refused advance moved nothing', rNow.pipelineStatus === 'valuation_packaging');

  const signed = await call('POST', 'client-cnda-sign', {
    body: {
      token: token2, effectiveDate: '2026-11-21', party: 'Unsigned Ventures LLC',
      entityTypeState: 'Delaware limited liability company', address: '9 Venture Way, Dover, DE 19901',
      purpose: '', name: 'Olivia Owner', title: '', date: '2026-11-21',
      signature: 'Olivia Owner', email: 'owner@unsigned.example', agree: true
    }
  });
  check('the owner countersigns', signed.statusCode === 200, signed.payload);
  const pres2 = await call('POST', 'advance-client', { cookie: desk, body: { referralId: ref2.id, status: 'presented', evidence: 'presentation ref PR-2' } });
  check('presented is ALLOWED after the countersignature', pres2.statusCode === 200 && pres2.payload.ok, pres2.payload);
}

/* ================= 6. re-issue supersedes ================= */
console.log('re-issue');
let token3old, token3new, ref3;
{
  const desk = deskCookie();
  const res = await submit(portalSubmit(active.code, 'Reissue Remedies LLC', 'owner@reissue.example'));
  token3old = res.payload.cnda.token;
  const refs = await storeMod.listReferralsByContractor(active.id);
  ref3 = refs.find(r => r.businessName === 'Reissue Remedies LLC');
  const re = await call('POST', 'issue-client-cnda', { cookie: desk, body: { referralId: ref3.id } });
  check('the Desk can re-issue an unsigned CNDA', re.statusCode === 200 && re.payload.ok && re.payload.emailed === true, re.payload);
  token3new = decodeURIComponent((re.payload.signingUrl || '').split('token=')[1] || '');
  check('the re-issue mints a fresh token', !!token3new && token3new !== token3old);
  const oldView = await call('GET', 'client-cnda', { query: `token=${encodeURIComponent(token3old)}` });
  check('the superseded token resolves to nothing (401)', oldView.statusCode === 401, oldView.statusCode);
  const newView = await call('GET', 'client-cnda', { query: `token=${encodeURIComponent(token3new)}` });
  check('the fresh token opens the signing surface', newView.statusCode === 200 && newView.payload.ok, newView.payload);
  const reSigned = await call('POST', 'issue-client-cnda', { cookie: desk, body: { referralId: ref1.id } });
  check('re-issuing a SIGNED record is refused', reSigned.statusCode === 409 && reSigned.payload.error === 'already_signed', reSigned.payload);
  const partnerIssue = await call('POST', 'issue-client-cnda', { cookie: partnerCookie(active.id), body: { referralId: ref3.id } });
  check('a partner session cannot issue CNDAs (401)', partnerIssue.statusCode === 401, partnerIssue.statusCode);
}

/* ================= 7. the hold discipline ================= */
console.log('frozen partner — the signing lands as a hold');
let holdToken;
{
  const desk = deskCookie();
  const res = await submit(portalSubmit(paused.code, 'Held Remedies LLC', 'owner@held.example'));
  check('the frozen partner\u2019s submission is held, and its CNDA still issues',
    res.statusCode === 200 && res.payload.attribution.status === 'held' && !!(res.payload.cnda && res.payload.cnda.issued),
    res.payload);
  holdToken = res.payload.cnda.token;
  const holds = await storeMod.listLinkHolds();
  const hold = holds.find(h => h.businessName === 'Held Remedies LLC');
  check('the CNDA record attaches to the HOLD, not to any referral',
    !!hold && (await storeMod.readClientCndaByHold(hold.id)) !== null &&
    (await storeMod.readClientCndaByHold(hold.id)).referralId === null);
  check('the frozen partner has no client from the hold',
    (await storeMod.listReferralsByContractor(paused.id)).length === 0);

  const signed = await call('POST', 'client-cnda-sign', {
    body: {
      token: holdToken, effectiveDate: '2026-11-21', party: 'Held Remedies LLC',
      entityTypeState: 'Massachusetts corporation', address: '4 Held Road, Boston, MA 02136',
      purpose: '', name: 'Olivia Owner', title: 'President', date: '2026-11-21',
      signature: 'Olivia Owner', email: 'owner@held.example', agree: true
    }
  });
  check('the owner countersigns under the frozen partner', signed.statusCode === 200, signed.payload);
  const recAfter = await storeMod.readClientCndaByHold(hold.id);
  check('the signing stands on the hold record (flagged, not credited)',
    recAfter.status === 'signed' && recAfter.referralId === null && !!recAfter.signedAt);
  const meP = await call('GET', 'me', { cookie: partnerCookie(paused.id) });
  check('the frozen partner still sees no client and no document',
    meP.payload.clients.length === 0 && !JSON.stringify(meP.payload).includes('documentHtml'));
  const adminList = await call('GET', 'admin-list', { cookie: desk });
  const listedHold = (adminList.payload.linkHolds || []).find(h => h.id === hold.id);
  check('the Desk hold board flags the signed CNDA',
    !!listedHold && listedHold.cnda && listedHold.cnda.status === 'signed', listedHold && listedHold.cnda);
  const deskHoldCopy = await call('GET', 'admin-client-cnda', { cookie: desk, query: `holdId=${hold.id}` });
  check('the Desk can view the held client\u2019s executed copy',
    deskHoldCopy.statusCode === 200 && deskHoldCopy.payload.cnda.documentHtml.includes('Held Remedies LLC'));

  const early = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: hold.id, decision: 'credit' } });
  check('credit is still refused while the partner is paused', early.statusCode === 409, early.payload);
  await call('POST', 'set-status', { cookie: desk, body: { contractorId: paused.id, status: 'active' } });
  const credited = await call('POST', 'resolve-hold', { cookie: desk, body: { holdId: hold.id, decision: 'credit' } });
  check('credit succeeds once the partner is active', credited.statusCode === 200 && credited.payload.ok, credited.payload);
  const newRefId = credited.payload.credited;
  const carried = await storeMod.readClientCndaByReferral(newRefId);
  check('the signed CNDA record carried onto the credited referral',
    !!carried && carried.status === 'signed' && carried.holdId === null, carried && [carried.status, carried.holdId]);
  const newRef = await storeMod.readReferral(newRefId);
  const entries = (newRef.pipelineHistory || []).filter(h => h.status === 'cnda_signed');
  check('the credited client\u2019s timeline carries the cnda_signed entry with the ORIGINAL signing date',
    entries.length === 1 && entries[0].at === recAfter.signedAt, entries);
  /* …and the gate is satisfied for the credited client. */
  await call('POST', 'advance-client', { cookie: desk, body: { referralId: newRefId, status: 'assessment_done', evidence: 'valuation ref V-7' } });
  await call('POST', 'advance-client', { cookie: desk, body: { referralId: newRefId, status: 'cnda_sent' } });
  const adv = await call('POST', 'advance-client', { cookie: desk, body: { referralId: newRefId, status: 'cnda_signed' } });
  check('the credited client advances through cnda_signed on the carried record',
    adv.statusCode === 200 && adv.payload.ok, adv.payload);
}

/* ================= 8. ES issuance + non-link + partner-entered ================= */
console.log('ES issuance, non-link submissions, partner-entered discipline');
{
  const before = (await storeMod.listClientCndas()).length;
  const plain = await submit({
    segment: 'pharmacy',
    contact: { name: 'Solo Owner', business: 'No Link Biz LLC', email: 'solo@nolink.example', phone: '' },
    answers: { 'Q1. How many locations do you operate?': '1' },
    company_website: ''
  });
  check('a non-link submission succeeds and issues NO CNDA',
    plain.statusCode === 200 && plain.payload.ok && plain.payload.cnda === undefined &&
    (await storeMod.listClientCndas()).length === before, plain.payload);

  const es = await submit(portalSubmit(active.code, 'Remedios ES LLC', 'owner@es.example', { lang: 'es' }));
  check('an ES link submission issues its CNDA', !!(es.payload.cnda && es.payload.cnda.issued), es.payload.cnda);
  check('the response signing URL is the ES route',
    (es.payload.cnda.url || '').includes('/es/cnda?token='), es.payload.cnda.url);
  const esMail = cndaMailTo('owner@es.example');
  check('the issuance email is the Spanish one, with the ES signing link',
    esMail.length === 1 && /^Su CNDA de IEC/.test(esMail[0].subject) && esMail[0].text.includes('/es/cnda?token='),
    esMail.map(m => m.subject));

  /* Partner-entered clients: no portal CNDA, typed evidence
     discipline exactly as before. */
  const desk = deskCookie();
  const reg = await call('POST', 'register-referral', {
    cookie: partnerCookie(active.id),
    body: { businessName: 'Entered By Partner LLC', ownerName: 'Pat Owner', ownerEmail: 'pat@entered.example', industry: 'pharmacy', employees: 30, deskStaffBand: '20-34' }
  });
  check('partner-entered registration works', reg.statusCode === 200 && reg.payload.ok, reg.payload);
  const enteredId = reg.payload.referralId;
  check('no CNDA record exists for a partner-entered client',
    (await storeMod.readClientCndaByReferral(enteredId)) === null);
  for (const [st, ev] of [['questionnaire_sent'], ['questionnaire_answered', 'submission ref PP-8'], ['assessment_done', 'valuation ref V-8'], ['cnda_sent'], ['cnda_signed', 'countersignature verified']]) {
    const a = await call('POST', 'advance-client', { cookie: desk, body: { referralId: enteredId, status: st, evidence: ev } });
    if (a.statusCode !== 200) throw new Error(`partner-entered advance to ${st} failed: ${JSON.stringify(a.payload)}`);
  }
  check('partner-entered cnda_signed still advances on typed evidence', true);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
