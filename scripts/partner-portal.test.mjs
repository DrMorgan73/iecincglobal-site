/* Standalone Partner Portal test suite (Nov 21, 2026 build):
   the extended 20-stage client pipeline with dated history and
   evidence gates, the amount-approved unlock, earnings (Projected
   from approved amounts only), payout settings, the W-9 hand-off,
   flat invited partners, the qualification gate, host-aware
   activation, the earnings downloads, the QR encoder, and the
   partner-facing content rules (no channel name, no estimator,
   owner-facing economics only on owner surfaces).

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables) and for Resend. No real database, no network.
   Run: node scripts/partner-portal.test.mjs   (exit 1 on failure) */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'https://neon-sql.test/sql';
delete process.env.DEMO_ADMIN_RESEND_API_KEY;

/* ---------------- mocked Neon SQL endpoint ---------------- */
const TABLES = { contractors: new Map(), contractor_referrals: new Map(), client_claims: new Map(), contractor_link_holds: new Map() };

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
const RESEND = { calls: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://neon-sql.test/sql') {
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  if (u === 'https://api.resend.com/emails') {
    RESEND.calls.push(JSON.parse(opts.body));
    return jsonRes(200, { id: 'resend-mock-id' });
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const mod = await import('../api/contractors.js');
const handler = mod.default;
const storeMod = await import('../api/_contractors-store.js');
const qrMod = await import('../api/_qr.js');

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
    getHeader(k) { return this.headers[k]; },
    end(s) { this.payload = s; }
  };
}
async function call(method, action, { body, cookie, query, host } = {}) {
  const url = '/api/contractors' + (action ? `?action=${action}` : '') + (query ? `&${query}` : '');
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (host) headers.host = host;
  const req = { method, url, headers, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`); }
}

/* Register + sign + invite + activate a partner through the real
   flow; returns { id, cookie } with a live session cookie taken
   from the activation response itself. */
async function makeActivePartner(email, name, company, host) {
  const r = await call('POST', 'register', { cookie: null, body: { name, email, company } });
  if (!(r.statusCode === 200 && r.payload.ok)) throw new Error('register failed: ' + JSON.stringify(r.payload));
  const id = (await storeMod.readContractorByEmail(email)).id;
  await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: id, signed: true } });
  await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: id, signed: true } });
  const inv = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: id } });
  if (!(inv.statusCode === 200 && inv.payload.activationUrl)) throw new Error('invite failed: ' + JSON.stringify(inv.payload));
  const token = inv.payload.activationUrl.split('token=')[1];
  const res = await call('GET', 'activate', { query: `token=${encodeURIComponent(token)}`, host });
  if (res.statusCode !== 302) throw new Error('activate failed: ' + res.statusCode + ' ' + JSON.stringify(res.payload));
  const cookie = String(res.headers['Set-Cookie'] || '').split(';')[0];
  return { id, cookie, location: res.headers.Location, token };
}

/* ================= extended pipeline + history ================= */
console.log('extended pipeline');
const p1 = await makeActivePartner('portal-one@example.test', 'Portal One', 'Portal One LLC');
check('activation on the main host keeps the legacy landing (pre-cutover)', p1.location === '/contractors-portal.html', p1.location);
const p1c = () => p1.cookie;

const reg = await call('POST', 'register-referral', {
  cookie: p1c(),
  body: { businessName: 'Pipeline Test Co', ownerName: 'Pat Owner', ownerEmail: 'pat@pipeline.test', industry: 'general-business', employees: 40, deskStaffBand: '35-75' }
});
check('client registered', reg.statusCode === 200 && reg.payload.ok && reg.payload.pipelineStatus === 'added', reg.payload);
const rid = reg.payload.referralId;
let me = await call('GET', 'me', { cookie: p1c() });
let client = me.payload.clients.find(c => c.id === rid);
check('history seeds with the dated added step', client.history.length === 1 && client.history[0].status === 'added' && !!client.history[0].at, client.history);
check('desk staff band recorded on the client', client.deskStaffBand === '35-75');
check('pipeline carries all 20 stages incl. the post-registration run',
  me.payload.pipeline.length === 20 && me.payload.pipeline.includes('intake_review') && me.payload.pipeline.includes('deal_closed'), me.payload.pipeline);

const jump = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: rid, status: 'assessment_done' } });
check('multi-step jump refused', jump.statusCode === 409, jump.payload);
const noEvidence = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: rid, status: 'questionnaire_answered' } });
// questionnaire_sent must come first; from 'added' this is a jump AND lacks evidence — either way refused.
check('out-of-order advance refused', noEvidence.statusCode === 409 || noEvidence.statusCode === 400, noEvidence.payload);
const walk = [
  ['questionnaire_sent'], ['questionnaire_answered', 'submission ref PP-2026-001'], ['assessment_done', 'assessment ref A-1'],
  ['cnda_sent'], ['cnda_signed', 'countersignature verified'], ['ready_to_register'], ['registered'],
  ['intake_review'], ['valuation_packaging'], ['presented', 'presentation ref PR-1'], ['buyer_diligence'],
  ['offer_received', 'offer ref OF-1'], ['negotiating_terms'], ['license_sent'], ['license_signed', 'signed license ref L-1'],
  ['data_delivery'], ['acceptance_review'], ['awaiting_payment'], ['deal_closed']
];
for (const [stage, evidence] of walk) {
  if (stage === 'presented') {
    const refused = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: rid, status: 'presented' } });
    check('presented without its evidence reference refused (400 evidence_required)',
      refused.statusCode === 400 && refused.payload.error === 'evidence_required', refused.payload);
  }
  const r = await call('POST', 'advance-client', { cookie: deskCookie(), body: { referralId: rid, status: stage, evidence } });
  if (!(r.statusCode === 200)) throw new Error(`advance to ${stage} failed: ${r.statusCode} ${JSON.stringify(r.payload)}`);
}
check('all 19 advances accepted in strict order', true);
me = await call('GET', 'me', { cookie: p1c() });
client = me.payload.clients.find(c => c.id === rid);
check('history records all 20 steps, each dated', client.history.length === 20 && client.history.every(h => !!h.at), client.history.length);
check('history ends at deal closed', client.history[client.history.length - 1].status === 'deal_closed');

/* fee events land on the same timeline via advance-referral */
const closeFee = await call('POST', 'advance-referral', { cookie: deskCookie(), body: { referralId: rid, status: 'license_closed', ownerGross: 500000 } });
check('license close computes the adopted fee ($500K -> $10,000)', closeFee.statusCode === 200 && closeFee.payload.referral.feeAmount === 10000, closeFee.payload);
me = await call('GET', 'me', { cookie: p1c() });
client = me.payload.clients.find(c => c.id === rid);
check('fee_earned appended to the timeline at close', client.history[client.history.length - 1].status === 'fee_earned');
check('earnings: payable carries the earned fee', me.payload.earnings.payable === 10000 && me.payload.earnings.earned === 10000, me.payload.earnings);
const payFee = await call('POST', 'advance-referral', { cookie: deskCookie(), body: { referralId: rid, status: 'fee_paid' } });
check('fee_paid advances', payFee.statusCode === 200, payFee.payload);
me = await call('GET', 'me', { cookie: p1c() });
check('earnings after payout: paid 10000, payable 0', me.payload.earnings.paid === 10000 && me.payload.earnings.payable === 0, me.payload.earnings);

/* ================= amount approved ================= */
console.log('amount approved');
const reg2 = await call('POST', 'register-referral', {
  cookie: p1c(),
  body: { businessName: 'Amount Test Co', ownerName: 'Amy Owner', ownerEmail: 'amy@amount.test', industry: 'home-health' }
});
const rid2 = reg2.payload.referralId;
me = await call('GET', 'me', { cookie: p1c() });
client = me.payload.clients.find(c => c.id === rid2);
check('amount hidden before IEC approval (value never in the payload)', client.amountApproved === false && client.approvedAmount === null, client);
const badAmt = await call('POST', 'set-approved-amount', { cookie: deskCookie(), body: { referralId: rid2, amount: -5 } });
check('negative approved amount refused', badAmt.statusCode === 400, badAmt.payload);
const setAmt = await call('POST', 'set-approved-amount', { cookie: deskCookie(), body: { referralId: rid2, amount: 216000 } });
check('desk approves an amount', setAmt.statusCode === 200, setAmt.payload);
me = await call('GET', 'me', { cookie: p1c() });
client = me.payload.clients.find(c => c.id === rid2);
check('approved amount unlocked for the partner', client.amountApproved === true && client.approvedAmount === 216000 && !!client.approvedAt);
check('projected = fee on approved amounts only ($216K -> $6,480)', me.payload.earnings.projected === 6480, me.payload.earnings);
await call('POST', 'set-approved-amount', { cookie: deskCookie(), body: { referralId: rid2, amount: null } });
me = await call('GET', 'me', { cookie: p1c() });
client = me.payload.clients.find(c => c.id === rid2);
check('clearing the approval re-locks the amount', client.amountApproved === false && client.approvedAmount === null && me.payload.earnings.projected === 0);

/* ================= qualification gate ================= */
console.log('qualification gate');
const beforeCount = TABLES.contractor_referrals.size;
const notQ = await call('POST', 'register-referral', {
  cookie: p1c(),
  body: { businessName: 'Small Staff Co', ownerName: 'Sam', ownerEmail: 'sam@small.test', industry: 'general-business', deskStaffBand: 'under-20' }
});
check('under-20 general business refused (not_qualified)', notQ.statusCode === 400 && notQ.payload.error === 'not_qualified', notQ.payload);
check('refused registration stored nothing', TABLES.contractor_referrals.size === beforeCount);
const exempt = await call('POST', 'register-referral', {
  cookie: p1c(),
  body: { businessName: 'Small Pharmacy Co', ownerName: 'Sue', ownerEmail: 'sue@rx.test', industry: 'pharmacy', deskStaffBand: 'under-20' }
});
check('under-20 exempt industry (pharmacy) registers', exempt.statusCode === 200, exempt.payload);
const badBand = await call('POST', 'register-referral', {
  cookie: p1c(),
  body: { businessName: 'Band Co', ownerName: 'Bo', ownerEmail: 'bo@band.test', industry: 'general-business', deskStaffBand: 'lots' }
});
check('unknown desk band refused', badBand.statusCode === 400, badBand.payload);

/* ================= payout + profile + IEC email ================= */
console.log('settings');
const badPayout = await call('POST', 'update-payout', { cookie: p1c(), body: { method: 'wire', last4: '12345' } });
check('five-digit last4 refused', badPayout.statusCode === 400, badPayout.payload);
const goodPayout = await call('POST', 'update-payout', { cookie: p1c(), body: { method: 'wire', last4: '6789' } });
check('payout saved (method + last 4 only)', goodPayout.statusCode === 200, goodPayout.payload);
me = await call('GET', 'me', { cookie: p1c() });
check('payout state in the me payload', me.payload.payout.set === true && me.payload.payout.method === 'wire' && me.payload.payout.last4 === '6789');
check('fast-start payouts step done', me.payload.fastStart.payoutsSet === true);
check('IEC email derived in the ruled format', me.payload.iecEmail === 'p.one@iecincglobal.com', me.payload.iecEmail);
const prof = await call('POST', 'update-profile', { cookie: p1c(), body: { phone: '617-555-0199', website: 'https://portal-one.example' } });
check('profile update saved', prof.statusCode === 200 && prof.payload.contractor.phone === '617-555-0199', prof.payload);

/* ================= W-9 ================= */
console.log('W-9');
const badW9 = await call('POST', 'upload-w9', { cookie: p1c(), body: { fileName: 'w9.pdf', dataBase64: Buffer.from('not a pdf').toString('base64') } });
check('non-PDF W-9 refused', badW9.statusCode === 400, badW9.payload);
const tinyPdf = Buffer.from('%PDF-1.4\n% test w9\n').toString('base64');
const noMail = await call('POST', 'upload-w9', { cookie: p1c(), body: { fileName: 'w9.pdf', dataBase64: tinyPdf } });
check('W-9 with no mail channel configured answers 503', noMail.statusCode === 503, noMail.payload);
me = await call('GET', 'me', { cookie: p1c() });
check('failed W-9 recorded nothing', me.payload.payout.w9OnFile === false);
process.env.DEMO_ADMIN_RESEND_API_KEY = 'test-key';
RESEND.calls = [];
const goodW9 = await call('POST', 'upload-w9', { cookie: p1c(), body: { fileName: 'w9.pdf', dataBase64: tinyPdf } });
check('valid W-9 accepted', goodW9.statusCode === 200 && goodW9.payload.w9OnFile === true, goodW9.payload);
check('W-9 emailed to the IEC office as an attachment, never stored',
  RESEND.calls.length === 1 && RESEND.calls[0].to.includes('info@iecincglobal.com')
  && Array.isArray(RESEND.calls[0].attachments) && RESEND.calls[0].attachments[0].content === tinyPdf, RESEND.calls.length);

/* ================= invited partners (flat) ================= */
console.log('invited partners');
me = await call('GET', 'me', { cookie: p1c() });
check('activation issued an invite code + partners-host join link',
  !!me.payload.inviteCode && me.payload.inviteLink === `https://partners.iecincglobal.com/join/${me.payload.inviteCode}`, me.payload.inviteLink);
check('invite message carries no money figures', !/\$|%/.test(me.payload.inviteMessage.body), me.payload.inviteMessage.body.slice(0, 80));
const resolved = await call('GET', 'resolve-invite', { query: `code=${encodeURIComponent(me.payload.inviteCode)}` });
check('invite link resolves and names the inviter', resolved.statusCode === 200 && resolved.payload.partner && resolved.payload.partner.name === 'Portal One', resolved.payload);
const inviteCode = me.payload.inviteCode;
const su2 = await call('POST', 'signup', {
  cookie: null,
  body: { name: 'Portal Two', company: 'Portal Two LLC', email: 'portal-two@example.test', phone: '617-555-0101', contractorType: 'Data network introductions', street: '2 Main St', city: 'Boston', state: 'MA', zip: '02136', inviteCode }
});
check('signup through the invite link accepted', su2.statusCode === 200 && su2.payload.ok, su2.payload);
const p2record = await storeMod.readContractorByEmail('portal-two@example.test');
check('the inviter is recorded on the new partner', p2record.invitedBy === p1.id, p2record.invitedBy);
me = await call('GET', 'me', { cookie: p1c() });
check('inviter sees exactly his own invitee', me.payload.invitedPartners.length === 1 && me.payload.invitedPartners[0].name === 'Portal Two', me.payload.invitedPartners);
check('invitee listing carries no financials', !('feeAmount' in me.payload.invitedPartners[0]) && !('earnings' in me.payload.invitedPartners[0]));
const p3 = await makeActivePartner('portal-three@example.test', 'Portal Three', 'Portal Three LLC');
const me3 = await call('GET', 'me', { cookie: p3.cookie });
check('another partner sees none of p1\u2019s invitees', me3.payload.invitedPartners.length === 0);
await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: p1.id, status: 'revoked' } });
const deadResolve = await call('GET', 'resolve-invite', { query: `code=${encodeURIComponent(inviteCode)}` });
check('a revoked inviter\u2019s link no longer resolves', deadResolve.statusCode === 404, deadResolve.payload);
const react = await call('POST', 'reactivate', { cookie: deskCookie(), body: { contractorId: p1.id } });
check('reactivate returns the record to invited with a fresh link', react.statusCode === 200 && react.payload.status === 'invited' && !!react.payload.activationUrl, react.payload);

/* ================= downloads ================= */
console.log('downloads');
const csv = await call('GET', 'earnings-csv', { cookie: partnerCookie(p1.id) });
check('earnings CSV generated from his records', csv.statusCode === 200 && String(csv.headers['content-type']).includes('text/csv')
  && String(csv.payload).startsWith('Business,Type,Stage,Registered,Amount approved by IEC,Owner gross,Your fee,Fee status,Fee paid date'), csv.statusCode);
check('CSV carries the closed client with its gross and fee', String(csv.payload).includes('Pipeline Test Co') && String(csv.payload).includes('500000') && String(csv.payload).includes('10000'));
const plan = await call('GET', 'plan-summary', { cookie: partnerCookie(p1.id) });
check('plan summary PDF generated', plan.statusCode === 200 && String(plan.headers['content-type']).includes('application/pdf')
  && Buffer.isBuffer(plan.payload) && plan.payload.slice(0, 5).toString() === '%PDF-' && plan.payload.length > 1000, plan.statusCode);

/* ================= host-aware activation ================= */
console.log('host-aware activation');
const p5 = await makeActivePartner('portal-five@example.test', 'Portal Five', 'Portal Five LLC', 'partners.iecincglobal.com');
check('activation on the partners host lands on the standalone root', p5.location === '/', p5.location);
const me5 = await call('GET', 'me', { cookie: p5.cookie });
check('partners-host session works in the standalone app', me5.statusCode === 200 && me5.payload.ok, me5.statusCode);

/* ================= QR encoder ================= */
console.log('QR');
const m1 = qrMod.qrMatrix('https://iecincglobal.com/r/VUNZ3YHP').matrix;
check('QR matrix built for a client link', Array.isArray(m1) && m1.length >= 21 && m1.length === m1[0].length);
const size = m1.length;
/* Read the 15 format bits (bit14 -> bit0) from both standard
   placements and confirm they agree and decode to a valid
   level-M format value produced by the encoder itself. */
/* Coordinates are [row, col], matching the encoder's placement:
   copy 1 runs along row 8 then up column 8; copy 2 runs down
   column 8 at the left edge's bottom, then along row 8 at the
   right edge — with the dark module between them, not a bit. */
const copy1Coords = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
const copy2Coords = [];
for (let i = 0; i < 7; i++) copy2Coords.push([size - 1 - i, 8]);
copy2Coords.push([8, size - 8]);
for (let j = 0; j < 7; j++) copy2Coords.push([8, size - 7 + j]);
const readFmt = coords => coords.reduce((a, [r, c]) => a * 2 + (m1[r][c] ? 1 : 0), 0);
const fmt1 = readFmt(copy1Coords);
const fmt2 = readFmt(copy2Coords);
check('QR format information: both copies agree', fmt1 === fmt2, fmt1.toString(2) + ' vs ' + fmt2.toString(2));
check('QR format information decodes to a level-M value from the encoder',
  [0, 1, 2, 3, 4, 5, 6, 7].some(mk => qrMod._internals.formatBits(mk) === fmt1), fmt1.toString(2));
/* Independent Reed-Solomon check: the syndromes of a full
   version-1 block (data + its EC) must all be zero. GF(256)
   arithmetic written here, in the test, from the spec. */
const GF_EXP = new Array(512).fill(0); const GF_LOG = new Array(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a, b) => (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;
const syndromes = (cw, ecLen) => {
  const out = [];
  for (let s = 0; s < ecLen; s++) {
    let y = 0;
    for (const c of cw) y = gfMul(y, GF_EXP[s]) ^ c;
    out.push(y);
  }
  return out;
};
const built = qrMod._internals.buildCodewords(new TextEncoder().encode('HELLO WORLD'));
check('QR Reed-Solomon: data+EC syndromes are zero (independent GF check)',
  built.version === 1 && syndromes(built.codewords, 10).every(s => s === 0), built.version);
check('QR SVG renders', qrMod.qrSvg('https://iecincglobal.com/r/VUNZ3YHP').startsWith('<svg'));

/* ================= content rules ================= */
console.log('content rules');
const appJs = readFileSync(new URL('../partners/app.js', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../partners/app.css', import.meta.url), 'utf8');
const shellEn = readFileSync(new URL('../partners/index.html', import.meta.url), 'utf8');
const shellEs = readFileSync(new URL('../es/partners/index.html', import.meta.url), 'utf8');
const allPartnerFacing = appJs + appCss + shellEn + shellEs;
check('no channel name anywhere partner-facing', !/datasupply/i.test(allPartnerFacing));
check('no Suite chrome in the portal files', !/IEC Suite|Suite sign-in/.test(allPartnerFacing));
check('no owner value estimator anywhere', !/estimat(e|or) your|value estimator|worth estimator/i.test(allPartnerFacing));
check('demo fixture carries the anchors (216000 approved, 6480 projected)', appJs.includes('216000') && appJs.includes('6480'));
check('six sections present in the app', ['nav_dashboard', 'nav_referrals', 'nav_earnings', 'nav_partners', 'nav_resources', 'nav_settings'].every(k => appJs.includes(k)));
check('ES shell is Spanish', shellEs.includes('lang="es"') && shellEs.includes('Portal de Socios'));
const meFinal = await call('GET', 'me', { cookie: partnerCookie(p3.id) });
check('client-link email states the program range + owner 80%',
  meFinal.payload.clientLinkEmail.body.includes('$100,000 to $5,000,000') && meFinal.payload.clientLinkEmail.body.includes('80%'));
check('client-link email never mentions the partner fee', !/3%|1% of|referral fee/i.test(meFinal.payload.clientLinkEmail.body));

console.log(failures === 0 ? '\npartner-portal.test.mjs: ALL GREEN' : `\npartner-portal.test.mjs: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
