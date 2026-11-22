/* Partner Portal — signed instruments inside the portal
   (Nov 21, 2026): the partner reads his full Contractor
   Referral Agreement and his full CNDA inside the portal and
   downloads a signed-copy PDF of each, DataSupply-style. The
   documents render from the texts of record with HIS acceptance
   of record on them; an office-recorded (paper) signature
   carries the office line instead — no invented timestamp.
   Session-only serving: the actions name no partner id, so a
   partner can only ever receive his own two documents.

   fetch is mocked for the Neon HTTPS SQL endpoint (in-memory
   tables) and for Resend. No real database, no network.
   Run: node scripts/partner-portal-documents.test.mjs */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const SECRET = 'test-partner-secret';
const DESK_SECRET = 'test-desk-secret';
process.env.CONTRACTOR_PORTAL_SECRET = SECRET;
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.CONTRACTORS_DATABASE_URL = 'https://neon-sql.test/sql';
delete process.env.DEMO_ADMIN_RESEND_API_KEY;

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
const docsMod = await import('../api/_partner-documents.js');

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

/* Reconstruct a generated PDF's text: every word is its own
   (…) Tj op in the content streams; unescape and join. */
function pdfText(buf) {
  const s = Buffer.from(buf).toString('latin1');
  const out = [];
  const re = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  let m;
  while ((m = re.exec(s))) {
    out.push(m[0].slice(1, m[0].lastIndexOf(')')).replace(/\\([()\\])/g, '$1'));
  }
  return out.join(' ');
}
function pdfTextSquashed(buf) {
  return pdfText(buf).replace(/\s+/g, '');
}
const sq = str => String(str).replace(/\s+/g, '');
function footerTotals(text) {
  const hits = [...text.matchAll(/Page (\d+) of (\d+)/g)];
  return {
    count: hits.length,
    consistent: hits.every(h => h[2] === hits[0][2]),
    maxPage: hits.length ? Math.max(...hits.map(h => Number(h[1]))) : 0,
    total: hits.length ? Number(hits[0][2]) : 0
  };
}

/* ============ Partner A — in-portal acceptance ============ */
console.log('partner A: in-portal acceptance');
await call('POST', 'register', { body: { name: 'Doc Alpha', email: 'doc-alpha@example.test', company: 'Alpha Docs LLC' } });
const aId = (await storeMod.readContractorByEmail('doc-alpha@example.test')).id;
const invA = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: aId } });
const tokenA = invA.payload.activationUrl.split('token=')[1];
const agrA = await call('GET', 'agreement', { query: 'token=' + encodeURIComponent(tokenA) });
const accA = await call('POST', 'accept-agreement', { body: { token: tokenA, typedName: 'Doc Alpha', accept: true } });
check('A accepted in-portal with version + timestamp', accA.statusCode === 200 && !!accA.payload.acceptance.at, accA.payload);
const atA = accA.payload.acceptance.at;
await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: aId, signed: true } });
const actA = await call('GET', 'activate', { query: 'token=' + encodeURIComponent(tokenA) });
const cookieA = String(actA.headers['Set-Cookie'] || '').split(';')[0];
check('A activated', actA.statusCode === 302 && !!cookieA, actA.statusCode);

/* ---- agreement: view ---- */
const viewA = await call('GET', 'my-agreement', { cookie: cookieA });
check('A views his agreement inside the portal', viewA.statusCode === 200 && viewA.payload.ok === true, viewA.statusCode);
check('agreement view carries the FULL text', viewA.payload.html.includes('IEC CONTRACTOR REFERRAL AGREEMENT')
  && viewA.payload.html.includes('1. Definitions') && viewA.payload.html.includes('EXHIBIT A'), viewA.payload.html.length);
check('agreement view carries his acceptance of record', viewA.payload.acceptance
  && viewA.payload.acceptance.name === 'Doc Alpha' && viewA.payload.acceptance.version === agrA.payload.version
  && viewA.payload.acceptance.at === atA, viewA.payload.acceptance);
check('agreement view renders the acceptance block (name + version)', viewA.payload.html.includes('Acceptance of record')
  && viewA.payload.html.includes('Doc Alpha') && viewA.payload.html.includes(agrA.payload.version));

/* ---- agreement: PDF ---- */
const pdfA = await call('GET', 'my-agreement-pdf', { cookie: cookieA });
check('A downloads his agreement PDF', pdfA.statusCode === 200 && String(pdfA.headers['content-type']).includes('application/pdf')
  && Buffer.isBuffer(pdfA.payload) && pdfA.payload.slice(0, 5).toString() === '%PDF-', pdfA.statusCode);
check('agreement PDF is an attachment with the document filename', String(pdfA.headers['content-disposition']).includes('iec-contractor-referral-agreement.pdf'));
const textA = pdfTextSquashed(pdfA.payload);
check('PDF text carries the instrument (fee sentence intact)', textA.includes(sq('3% of the first $250,000')), textA.slice(0, 120));
check('PDF acceptance block: typed name', textA.includes(sq('Accepted and signed in the IEC Partner Portal by: Doc Alpha')));
check('PDF acceptance block: version', textA.includes(sq(`Agreement version: ${agrA.payload.version}`)), agrA.payload.version);
check('PDF acceptance block: the exact recorded timestamp (UTC)', textA.includes(sq(`Date and time of acceptance (UTC): ${docsMod._internals.fmtUtc(atA)}`)),
  docsMod._internals.fmtUtc(atA));
check('PDF acceptance timestamp is a real UTC instant', /\d{4}-\d{2}-\d{2}\d{2}:\d{2}:\d{2}UTC/.test(textA));
const footA = footerTotals(pdfText(pdfA.payload));
check('PDF footer stamped after layout: Page X of Y on every page, totals consistent',
  footA.count > 1 && footA.consistent && footA.maxPage === footA.total, footA);

/* ---- CNDA: view + PDF ---- */
const viewCA = await call('GET', 'my-cnda', { cookie: cookieA });
check('A views his CNDA inside the portal', viewCA.statusCode === 200 && viewCA.payload.ok === true, viewCA.statusCode);
check('CNDA view carries the central text, unaltered', viewCA.payload.html.includes('General CNDA and Procuring Party Agreement')
  && viewCA.payload.html.includes('Covered Assets') && viewCA.payload.html.includes('Prohibited Engagements'));
check('CNDA view is filled with HIS record (company named, placeholder gone)', viewCA.payload.html.includes('Alpha Docs LLC')
  && !viewCA.payload.html.includes('[COUNTERPARTY NAME]'));
check('CNDA view carries the acceptance of record + IEC signatory', viewCA.payload.html.includes('Acceptance of record')
  && viewCA.payload.html.includes('Mohammed Morgan, MD'));
const pdfCA = await call('GET', 'my-cnda-pdf', { cookie: cookieA });
check('A downloads his CNDA PDF', pdfCA.statusCode === 200 && Buffer.isBuffer(pdfCA.payload)
  && pdfCA.payload.slice(0, 5).toString() === '%PDF-' && String(pdfCA.headers['content-disposition']).includes('iec-cnda.pdf'), pdfCA.statusCode);
const textCA = pdfTextSquashed(pdfCA.payload);
check('CNDA PDF filled with his record (company + address)', textCA.includes(sq('Alpha Docs LLC')) && !textCA.includes('[COUNTERPARTYNAME]'));
check('CNDA PDF carries the acceptance of record', textCA.includes(sq('Acceptance of record')) && textCA.includes(sq('Mohammed Morgan, MD')));
const footCA = footerTotals(pdfText(pdfCA.payload));
check('CNDA PDF footer: Page X of Y, totals consistent', footCA.count > 1 && footCA.consistent && footCA.maxPage === footCA.total, footCA);

/* ============ Partner B — office-recorded (paper) ============ */
console.log('partner B: office-recorded signature');
await call('POST', 'register', { body: { name: 'Doc Beta', email: 'doc-beta@example.test', company: 'Beta Docs LLC' } });
const bId = (await storeMod.readContractorByEmail('doc-beta@example.test')).id;
await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: bId, signed: true } });
await call('POST', 'set-nda', { cookie: deskCookie(), body: { contractorId: bId, signed: true } });
const invB = await call('POST', 'invite', { cookie: deskCookie(), body: { contractorId: bId } });
const tokenB = invB.payload.activationUrl.split('token=')[1];
const actB = await call('GET', 'activate', { query: 'token=' + encodeURIComponent(tokenB) });
const cookieB = String(actB.headers['Set-Cookie'] || '').split(';')[0];

const viewB = await call('GET', 'my-agreement', { cookie: cookieB });
check('B views his agreement; acceptance is null (no portal acceptance exists)', viewB.statusCode === 200
  && viewB.payload.acceptance === null, viewB.payload && viewB.payload.acceptance);
check('B\u2019s view shows the office-recorded line', viewB.payload.html.includes('recorded by the IEC office'));
const pdfB = await call('GET', 'my-agreement-pdf', { cookie: cookieB });
const textB = pdfTextSquashed(pdfB.payload);
check('B\u2019s PDF carries the office-recorded line', textB.includes(sq('recorded by the IEC office')));
check('B\u2019s PDF invents NO portal acceptance (no typed-name line, no acceptance timestamp)',
  !textB.includes(sq('Accepted and signed in the IEC Partner Portal by')) && !textB.includes(sq('Date and time of acceptance')));
const viewCB = await call('GET', 'my-cnda', { cookie: cookieB });
check('B views his own CNDA (his company, not A\u2019s)', viewCB.statusCode === 200 && viewCB.payload.html.includes('Beta Docs LLC')
  && !viewCB.payload.html.includes('Alpha Docs LLC'));

/* ============ isolation: a partner can only name his own ============ */
console.log('isolation');
const crossPdf = await call('GET', 'my-agreement-pdf', { cookie: cookieB, query: `contractorId=${aId}` });
const crossText = pdfTextSquashed(crossPdf.payload);
check('a contractorId parameter names nothing: B still gets B\u2019s copy', crossPdf.statusCode === 200
  && crossText.includes(sq('Doc Beta')) && !crossText.includes(sq('Doc Alpha')));
const crossView = await call('GET', 'my-cnda', { cookie: cookieA, query: `contractorId=${bId}` });
check('A asking with B\u2019s id still gets A\u2019s CNDA', crossView.statusCode === 200
  && crossView.payload.html.includes('Alpha Docs LLC') && !crossView.payload.html.includes('Beta Docs LLC'));
for (const action of ['my-agreement', 'my-agreement-pdf', 'my-cnda', 'my-cnda-pdf']) {
  const noSess = await call('GET', action, {});
  check(`${action}: no session -> 401`, noSess.statusCode === 401, noSess.statusCode);
  const deskSess = await call('GET', action, { cookie: deskCookie() });
  check(`${action}: a Desk session is not a partner session -> 401`, deskSess.statusCode === 401, deskSess.statusCode);
}

/* ============ gating: unsigned documents do not exist ============ */
console.log('gating');
await call('POST', 'register', { body: { name: 'Doc Pending', email: 'doc-pending@example.test', company: 'Pending LLC' } });
const cId = (await storeMod.readContractorByEmail('doc-pending@example.test')).id;
for (const action of ['my-agreement', 'my-agreement-pdf', 'my-cnda', 'my-cnda-pdf']) {
  const r = await call('GET', action, { cookie: partnerCookie(cId) });
  check(`${action}: nothing signed -> 404`, r.statusCode === 404 && r.payload.error === 'not_signed', r.statusCode);
}
/* agreement signed, NDA outstanding: documents gate independently */
await call('POST', 'set-agreement', { cookie: deskCookie(), body: { contractorId: cId, signed: true } });
const halfAgr = await call('GET', 'my-agreement', { cookie: partnerCookie(cId) });
const halfCnda = await call('GET', 'my-cnda', { cookie: partnerCookie(cId) });
check('agreement alone stands: agreement viewable, CNDA still 404', halfAgr.statusCode === 200 && halfCnda.statusCode === 404,
  `${halfAgr.statusCode}/${halfCnda.statusCode}`);

/* ============ frozen partner keeps his read-only copies ============ */
console.log('frozen partner');
await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: aId, status: 'paused' } });
const frozenView = await call('GET', 'my-agreement', { cookie: cookieA });
const frozenPdf = await call('GET', 'my-cnda-pdf', { cookie: cookieA });
check('a paused partner still reads/downloads his own signed copies (read-only, like his portal view)',
  frozenView.statusCode === 200 && frozenPdf.statusCode === 200, `${frozenView.statusCode}/${frozenPdf.statusCode}`);
await call('POST', 'set-status', { cookie: deskCookie(), body: { contractorId: aId, status: 'active' } });

/* ============ app wiring (EN + ES) ============ */
console.log('app wiring');
const appJs = readFileSync(new URL('../partners/app.js', import.meta.url), 'utf8');
check('app routes the two readers', appJs.includes("'agreement', 'cnda'") && appJs.includes("viewDocument(me, 'agreement')") && appJs.includes("viewDocument(me, 'cnda')"));
check('app wires both PDF downloads', appJs.includes("downloadHref('my-agreement-pdf')") && appJs.includes("downloadHref('my-cnda-pdf')"));
check('buttons sit at all three acceptance sites', (appJs.match(/docButtons\(me\)/g) || []).length >= 4,
  (appJs.match(/docButtons\(me\)/g) || []).length);
check('EN strings present', appJs.includes("doc_view_agreement: 'View agreement'") && appJs.includes("doc_view_cnda: 'View CNDA'"));
check('ES strings present', appJs.includes("doc_view_agreement: 'Ver el acuerdo'") && appJs.includes("doc_view_cnda: 'Ver el CNDA'"));
check('no channel name introduced partner-facing', !/datasupply/i.test(appJs));

console.log(failures === 0 ? '\npartner-portal-documents.test.mjs: ALL GREEN' : `\npartner-portal-documents.test.mjs: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
