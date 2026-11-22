/* IEC Partner Portal — ADD-A-CLIENT AUDIT suite (Nov 21, 2026).
   DrMorgan's order: "IEC PP audit Add a client." Adversarial
   coverage of BOTH entry paths:
     A) partner-entered (register-referral: qualification gate,
        counts-only form, duplicate guard, pipeline, frozen rules)
     B) owner via partner link (/r/<code> -> questionnaire-submit:
        duplicate guard, holds, CNDA issuance trigger)
   plus Desk consistency, cross-partner isolation, data integrity
   (byte-identical store after every refusal; amounts never
   settable through the add flow) and the ES twins.

   Same mocked-Neon + Blob-hooks harness as the CNDA suite, plus
   a Resend capture. Run: node scripts/partner-portal-add-client-audit.test.mjs */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';

register('./testing/blob-hooks.mjs', import.meta.url);

const SECRET = 'test-partner-secret';
const DESK_SECRET = ['test','desk','secret'].join('-');
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = ['https://neon','sql.test/sql'].join('-');
process.env.QUESTIONNAIRE_DATABASE_URL = ['https://neon','sql.test/sql'].join('-');
process.env.BLOB_READ_WRITE_TOKEN = ['test','blob','token'].join('-');
process.env.DEMO_ADMIN_RESEND_API_KEY = ['test','resend','key'].join('-');
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
/* Byte-level store snapshot: a refused submission must leave
   every table exactly as it was. */
function snap() {
  const o = {};
  for (const [k, m] of Object.entries(TABLES)) o[k] = [...m.entries()];
  return JSON.stringify(o);
}

/* ================= seed partners ================= */
async function seedPartner(email, name, status) {
  const id = crypto.randomUUID();
  await storeMod.createContractor({ id, email, name, company: name + ' LLC', activationTokenHash: '' });
  await storeMod.updateContractor(id, { status, ndaStatus: 'signed', agreementStatus: 'signed' });
  const code = await storeMod.ensureContractorClientCode(id);
  return { id, code, cookie: partnerCookie(id) };
}
const A = await seedPartner('audit-a@example.com', 'Audit Alpha', 'active');
const B = await seedPartner('audit-b@example.com', 'Audit Beta', 'active');
const PZ = await seedPartner('audit-paused@example.com', 'Audit Paused', 'paused');
const RV = await seedPartner('audit-revoked@example.com', 'Audit Revoked', 'revoked');

const addAs = (who, body) => call('POST', 'register-referral', { cookie: who.cookie, body });
const BASE = { ownerName: 'Olivia Owner', industry: 'general-business', deskStaffBand: '20-34' };

/* ================= 1. qualification gate (path A) ================= */
console.log('1. qualification gate — partner-entered');
{
  let before = snap();
  const r = await addAs(A, { ...BASE, businessName: 'Tiny Retail LLC', ownerEmail: 'tiny@retail.test', deskStaffBand: 'under-20', employees: 6 });
  check('under-20 + general-business -> 400 not_qualified', r.statusCode === 400 && r.payload.error === 'not_qualified', r.payload);
  check('under-20 refusal stored NOTHING (store byte-identical)', snap() === before);

  before = snap();
  const g = await addAs(A, { ...BASE, businessName: 'Tiny Fuel LLC', ownerEmail: 'tiny@fuel.test', industry: 'gas-convenience', deskStaffBand: 'under-20', employees: 4 });
  check('under-20 + gas-convenience (non-exempt) -> 400 not_qualified', g.statusCode === 400 && g.payload.error === 'not_qualified', g.payload);
  check('gas refusal stored NOTHING', snap() === before);

  for (const [industry, biz] of [['home-health', 'Audit Home Health LLC'], ['physical-therapy', 'Audit PT LLC'], ['medical-practice', 'Audit Medical LLC'], ['pharmacy', 'Audit Pharmacy LLC']]) {
    const ok = await addAs(A, { ...BASE, businessName: biz, ownerEmail: `owner@${biz.replace(/[^a-z]/gi, '').toLowerCase()}.test`, industry, deskStaffBand: 'under-20', employees: 5 });
    check(`under-20 + exempt industry ${industry} -> registered`, ok.statusCode === 200 && ok.payload.ok, ok.payload);
  }

  before = snap();
  const badBand = await addAs(A, { ...BASE, businessName: 'Bandless Co', ownerEmail: 'band@less.test', deskStaffBand: 'lots' });
  check('invalid desk-staff band -> 400 invalid_fields', badBand.statusCode === 400 && badBand.payload.error === 'invalid_fields', badBand.payload);
  check('invalid-band refusal stored NOTHING', snap() === before);

  before = snap();
  const noBand = await addAs(A, { businessName: 'Sneaky Small LLC', ownerName: 'Sly', ownerEmail: 'sly@sneaky.test', industry: 'general-business', employees: 3 });
  check('DIRECT API: no gate answers at all (band omitted) -> 400, gate cannot be bypassed by omission',
    noBand.statusCode === 400, noBand.payload);
  check('omission-bypass refusal stored NOTHING', snap() === before);

  const hh = (await storeMod.listReferralsByContractor(A.id)).find(r => r.businessName === 'Audit Home Health LLC');
  check('gate answers recorded on the client record (band + industry)',
    hh && hh.deskStaffBand === 'under-20' && hh.industry === 'home-health', hh && [hh.deskStaffBand, hh.industry]);
  var hhId = hh && hh.id;
}

/* ================= 2. counts only — identifier refusal (path A) ================= */
console.log('2. counts only — identifiers refused before any write');
{
  const attempts = [
    ['email in an answer', { questionnaireAnswers: { q8: 'write to owner@leak.test' } }, 'identifier_content'],
    ['phone in an answer', { questionnaireAnswers: { q11: 'call 617-555-0134' } }, 'identifier_content'],
    ['SSN in an answer', { questionnaireAnswers: { q8: '123-45-6789' } }, 'identifier_content'],
    ['birth-date in an answer', { questionnaireAnswers: { q3: 'born 03/14/1980' } }, 'identifier_content'],
    ['phone in the employees count field', { employees: 'call 617-555-0134' }, 'invalid_fields'],
    ['a personal name in the employees count field', { employees: 'John Smith' }, 'invalid_fields'],
    ['an unknown answer key', { questionnaireAnswers: { q99: '5' } }, 'invalid_answers']
  ];
  for (const [label, extra, want] of attempts) {
    const before = snap();
    const r = await addAs(A, { ...BASE, businessName: `Leak ${label} Co`, ownerEmail: `leak${Math.abs(label.length * 7 % 997)}@t.test`, ...extra });
    check(`${label} -> 400 ${want}`, r.statusCode === 400 && r.payload.error === want, r.payload);
    check(`${label} -> NOTHING stored`, snap() === before);
  }
  const before = snap();
  const sys = await addAs(A, { ...BASE, businessName: 'Leak Systems Co', ownerEmail: 'sys@leak.test', systems: 'Epic — questions to owner@leak.test or 617-555-0134' });
  check('identifier in the free-text SYSTEMS field -> 400 identifier_in_field',
    sys.statusCode === 400 && sys.payload.error === 'identifier_in_field', sys.payload);
  check('systems-identifier refusal stored NOTHING', snap() === before);

  const beforeUpd = snap();
  const upd = await call('POST', 'update-client', { cookie: A.cookie, body: { clientId: hhId, systems: 'Call the owner at 617-555-0134' } });
  check('identifier via update-client systems -> 400 identifier_in_field',
    upd.statusCode === 400 && upd.payload.error === 'identifier_in_field', upd.payload);
  check('update-client refusal left the record byte-identical', snap() === beforeUpd);
}

/* ================= 3. duplicate guard ================= */
console.log('3. duplicate guard — same partner, cross-partner, cross-path');
{
  const before = snap();
  const dup1 = await addAs(A, { ...BASE, businessName: 'Audit Home Health LLC', ownerName: 'Someone Else', ownerEmail: 'else@other.test', industry: 'home-health' });
  check('same partner re-adds the same business -> 409 already_registered', dup1.statusCode === 409 && dup1.payload.error === 'already_registered', dup1.payload);
  check('duplicate refusal stored NOTHING', snap() === before);

  const dup2 = await addAs(B, { ...BASE, businessName: 'AUDIT HOME HEALTH, LLC', ownerName: 'Third Person', ownerEmail: 'third@other.test', industry: 'home-health' });
  check('second partner, normalised name variant (case/punct/suffix) -> 409', dup2.statusCode === 409 && dup2.payload.error === 'already_registered', dup2.payload);
  check('refusal names no holder (no partner name, no record id leaked)',
    !JSON.stringify(dup2.payload).includes('Audit Alpha') && !JSON.stringify(dup2.payload).includes(hhId), dup2.payload);

  const dup3 = await addAs(B, { ...BASE, businessName: 'Totally Different Name LLC', ownerName: 'Olivia Owner', ownerEmail: 'owner@audithomehealthllc.test', industry: 'pharmacy' });
  check('same owner email under a different business name -> 409', dup3.statusCode === 409 && dup3.payload.error === 'already_registered', dup3.payload);

  const admin = await call('GET', 'admin-list', { cookie: deskCookie() });
  const deskSees = (admin.payload.referrals || []).find(r => r.id === hhId);
  check('the Desk sees the standing registration that blocks duplicates (admin-list carries it)',
    !!deskSees && deskSees.businessName === 'Audit Home Health LLC', deskSees && deskSees.businessName);

  /* cross-path A -> B: partner-entered first, link second */
  const cp = await addAs(A, { ...BASE, businessName: 'Cross Path Co', ownerEmail: 'cp@cross.test' });
  check('cross-path setup: partner-entered Cross Path Co registered', cp.statusCode === 200, cp.payload);
  const subsBefore = TABLES.questionnaire_submissions.size;
  const cndasBefore = (await storeMod.listClientCndas()).length;
  const linkDup = await submit({
    segment: 'general-business',
    contact: { name: 'Cross Owner', business: 'Cross Path Co', email: 'cp@cross.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '900' },
    company_website: '', partnerCode: B.code,
    partnerProfile: { businessName: 'Cross Path Co', city: 'Boston', state: 'MA' }
  });
  check('link submission duplicating a partner-entered business -> 409 already_registered',
    linkDup.statusCode === 409 && linkDup.payload.error === 'already_registered', linkDup.payload);
  check('link duplicate stored no submission and issued no CNDA',
    TABLES.questionnaire_submissions.size === subsBefore && (await storeMod.listClientCndas()).length === cndasBefore);

  /* cross-path B -> A: link first, partner-entered second */
  const linkFirst = await submit({
    segment: 'general-business',
    contact: { name: 'Link Owner', business: 'Link First Co', email: 'owner@linkfirst.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '1,200' },
    company_website: '', partnerCode: A.code,
    partnerProfile: { businessName: 'Link First Co', city: 'Cambridge', state: 'MA' }
  });
  check('cross-path setup: link submission credited', linkFirst.statusCode === 200 && linkFirst.payload.attribution && linkFirst.payload.attribution.status === 'credited', linkFirst.payload);
  var linkRef = (await storeMod.listReferralsByContractor(A.id)).find(r => r.businessName === 'Link First Co');
  const dupB = await addAs(B, { ...BASE, businessName: 'Link First Co', ownerName: 'Late Partner', ownerEmail: 'late@partner.test' });
  check('partner-entered add duplicating a link-created client -> 409', dupB.statusCode === 409 && dupB.payload.error === 'already_registered', dupB.payload);

  /* honest limit: a genuinely different name (extra word) with a
     different owner email is NOT caught by the key/email guard —
     documented behaviour, caught later by office review. */
  const near = await submit({
    segment: 'general-business',
    contact: { name: 'Other Owner', business: 'Link First Company Services', email: 'other@linkfirstsvcs.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '40' },
    company_website: '', partnerCode: B.code,
    partnerProfile: { businessName: 'Link First Company Services', city: 'Cambridge', state: 'MA' }
  });
  check('DOCUMENTED LIMIT: name-variant near-duplicate (extra word, new email) is not caught by the guard',
    near.statusCode === 200 && near.payload.ok, near.payload);
}

/* ================= 4. pipeline + Desk + isolation ================= */
console.log('4. pipeline landing, Desk consistency, cross-partner isolation');
{
  const hh = await storeMod.readReferral(hhId);
  check('partner-entered client lands at stage "added"', hh.pipelineStatus === 'added', hh.pipelineStatus);
  check('dated timeline entry exists for the landing (history[0] = added, ISO date)',
    Array.isArray(hh.pipelineHistory) && hh.pipelineHistory.length === 1 && hh.pipelineHistory[0].status === 'added' && /^\d{4}-\d{2}-\d{2}T/.test(hh.pipelineHistory[0].at), hh.pipelineHistory);

  const mine = await call('GET', 'get-client', { cookie: A.cookie, query: `id=${hhId}` });
  check('owner partner reads his own client (same id, same stage)',
    mine.statusCode === 200 && mine.payload.client.id === hhId && mine.payload.client.pipelineStatus === 'added', mine.payload);

  const admin = await call('GET', 'admin-list', { cookie: deskCookie() });
  const deskRow = (admin.payload.referrals || []).find(r => r.id === hhId);
  check('Desk record matches the partner view (same client, same stage)',
    !!deskRow && deskRow.pipelineStatus === hh.pipelineStatus && deskRow.businessName === hh.businessName);

  const before = snap();
  const xRead = await call('GET', 'get-client', { cookie: B.cookie, query: `id=${hhId}` });
  check("another partner reading the client -> 404 (never the record)", xRead.statusCode === 404, xRead.statusCode);
  const xUpd = await call('POST', 'update-client', { cookie: B.cookie, body: { clientId: hhId, employees: 999 } });
  check("another partner updating the client -> 404", xUpd.statusCode === 404, xUpd.statusCode);
  const xSend = await call('POST', 'send-questionnaire', { cookie: B.cookie, body: { clientId: hhId } });
  check("another partner sending the questionnaire -> 404", xSend.statusCode === 404, xSend.statusCode);
  check('cross-partner attempts changed NOTHING', snap() === before);
}

/* ================= 5. frozen partners ================= */
console.log('5. frozen partners — no adds; link submissions become Desk holds');
{
  let before = snap();
  const pz = await addAs(PZ, { ...BASE, businessName: 'Paused Add Co', ownerEmail: 'pz@add.test' });
  check('paused partner add via API -> 401', pz.statusCode === 401, pz.payload);
  const rv = await addAs(RV, { ...BASE, businessName: 'Revoked Add Co', ownerEmail: 'rv@add.test' });
  check('revoked partner add via API -> 401', rv.statusCode === 401, rv.payload);
  check('frozen add attempts stored NOTHING', snap() === before);

  const appJs = await readFile(new URL('../partners/app.js', import.meta.url), 'utf8');
  check('UI: the add form + qualification gate render only when the portal is not frozen',
    appJs.includes('if (!me.frozen) html += qualificationHtml() + addClientHtml(me)'));

  const heldP = await submit({
    segment: 'pharmacy',
    contact: { name: 'Held Owner', business: 'Held Pharmacy LLC', email: 'held@pharmacy.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '300' },
    company_website: '', partnerCode: PZ.code,
    partnerProfile: { businessName: 'Held Pharmacy LLC', city: 'Boston', state: 'MA' }
  });
  check('link submission under a PAUSED partner -> accepted as held (not credited)',
    heldP.statusCode === 200 && heldP.payload.attribution && heldP.payload.attribution.status === 'held', heldP.payload);
  const holdsP = (await storeMod.listLinkHolds()).filter(h => h.contractorId === PZ.id);
  check('a flagged Desk hold stands with reason "paused"',
    holdsP.length === 1 && holdsP[0].reason === 'paused' && holdsP[0].businessName === 'Held Pharmacy LLC', holdsP.map(h => h.reason));
  check('the paused partner was credited NOTHING (no referral)',
    (await storeMod.listReferralsByContractor(PZ.id)).length === 0);
  const holdCnda = (await storeMod.listClientCndas()).find(c => c.holdId && holdsP.length && c.holdId === holdsP[0].id);
  check('the CNDA for a held owner is issued against the HOLD (carry-over anchor)',
    !!holdCnda, (await storeMod.listClientCndas()).map(c => [c.referralId, c.holdId]));

  const heldR = await submit({
    segment: 'pharmacy',
    contact: { name: 'Held Owner Two', business: 'Held Two Pharmacy LLC', email: 'held2@pharmacy.test', phone: '' },
    answers: { 'Q8. Customers/clients served per year': '120' },
    company_website: '', partnerCode: RV.code,
    partnerProfile: { businessName: 'Held Two Pharmacy LLC', city: 'Boston', state: 'MA' }
  });
  const holdsR = (await storeMod.listLinkHolds()).filter(h => h.contractorId === RV.id);
  check('link submission under a REVOKED partner -> held with reason "revoked"',
    heldR.statusCode === 200 && holdsR.length === 1 && holdsR[0].reason === 'revoked', heldR.payload);
}

/* ================= 6. CNDA trigger (path B only) ================= */
console.log('6. CNDA trigger — link clients only; presented gate');
{
  const cndas = await storeMod.listClientCndas();
  const linkCnda = cndas.find(c => c.referralId === linkRef.id);
  check('link-path client got the portal CNDA issued at questionnaire submission',
    !!linkCnda && linkCnda.status !== 'signed', linkCnda && linkCnda.status);
  check('partner-entered client got NO portal CNDA (keeps the central-CNDA path)',
    !cndas.some(c => c.referralId === hhId));

  /* walk the link client to the presented gate, one stage at a
     time with Desk evidence, and prove the gate holds unsigned */
  const walk = ['assessment_done', 'cnda_sent', 'cnda_signed', 'ready_to_register', 'registered', 'intake_review', 'valuation_packaging'];
  let last = null;
  for (const stage of walk) {
    last = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: linkRef.id, status: stage, evidence: `audit walk ${stage}` } });
    if (last.statusCode !== 200) break;
  }
  check('walk to valuation_packaging succeeds with evidence', last && last.statusCode === 200, last && last.payload);
  const blocked = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: linkRef.id, status: 'presented', evidence: 'audit presentation ref' } });
  check('presented REFUSED until the link client CNDA is countersigned (409 cnda_required)',
    blocked.statusCode === 409 && blocked.payload.error === 'cnda_required', blocked.payload);
  const after = await storeMod.readReferral(linkRef.id);
  check('the refused advance left the client at valuation_packaging', after.pipelineStatus === 'valuation_packaging', after.pipelineStatus);
}

/* ================= 7. data integrity ================= */
console.log('7. data integrity — amounts never settable; source recorded');
{
  const inj = await addAs(A, { ...BASE, businessName: 'Amount Injection Co', ownerEmail: 'inj@amount.test', approvedAmount: 500000, amountApproved: true, approved_amount: 500000, feeAmount: 9999, fee_amount: 9999 });
  check('add carrying amount/fee fields still registers (fields ignored)', inj.statusCode === 200 && inj.payload.ok, inj.payload);
  const row = await storeMod.readReferral(inj.payload.referralId);
  check('no amount was set through the add flow (approvedAmount null)',
    row.approvedAmount === null || row.approvedAmount === undefined, row.approvedAmount);
  check('no fee was set through the add flow (feeAmount null)',
    row.feeAmount === null || row.feeAmount === undefined, row.feeAmount);

  const hh = await storeMod.readReferral(hhId);
  check('source recorded: partner-entered add -> "partner-entered"', hh.source === 'partner-entered', hh.source);
  check('source recorded: link submission -> "link"', linkRef.source === 'link', linkRef.source);
}

/* ================= 8. ES twins ================= */
console.log('8. ES twins');
{
  const esShell = await readFile(new URL('../es/partners/index.html', import.meta.url), 'utf8');
  const enShell = await readFile(new URL('../partners/index.html', import.meta.url), 'utf8');
  check('ES portal shell loads the SAME /partners/app.js as EN (one logic, two languages)',
    esShell.includes('/partners/app.js') && enShell.includes('/partners/app.js'));
  const appJs = await readFile(new URL('../partners/app.js', import.meta.url), 'utf8');
  check('the qualification-gate strings exist in Spanish (qual_fail ES)',
    appJs.includes('Este negocio aún no califica'));

  const mailBefore = sentMail.length;
  const es = await submit({
    segment: 'general-business', lang: 'es',
    contact: { name: 'Dueña ES', business: 'Negocio ES LLC', email: 'duena@negocio.test', phone: '' },
    answers: { 'Q8. Clientes atendidos por año': '700' },
    company_website: '', partnerCode: A.code,
    partnerProfile: { businessName: 'Negocio ES LLC', city: 'Boston', state: 'MA' }
  });
  check('ES link submission credits the client the same way', es.statusCode === 200 && es.payload.attribution && es.payload.attribution.status === 'credited', es.payload);
  const esRef = (await storeMod.listReferralsByContractor(A.id)).find(r => r.businessName === 'Negocio ES LLC');
  check('ES-created client recorded with source "link"', !!esRef && esRef.source === 'link', esRef && esRef.source);
  const esCndaMail = sentMail.slice(mailBefore).filter(m => (m.to || []).includes('duena@negocio.test') && /Su CNDA de IEC/.test(m.subject || ''));
  check('ES owner receives the CNDA issuance email in Spanish', esCndaMail.length === 1, sentMail.slice(mailBefore).map(m => m.subject));
}

console.log(failures === 0 ? '\nADD-CLIENT AUDIT: ALL GREEN' : `\nADD-CLIENT AUDIT: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
