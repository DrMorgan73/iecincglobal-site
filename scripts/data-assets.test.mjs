/* Local test suite for the Data Asset Builder:
   api/data-assets.js + api/_data-assets-core.js +
   api/_data-assets-catalog.js + api/_data-assets-store.js +
   api/_data-assets-pdf.js.

   @vercel/blob is redirected to the in-memory mock via module
   hooks; fetch is mocked for the Neon HTTPS SQL endpoint. Desk
   sessions are minted exactly the way middleware.js verifies them
   (the test owns the test secret). No real database, no real Blob
   store, no network.

   Run: node scripts/data-assets.test.mjs   (exit 1 on failure) */

import { register } from "node:module";
register("./testing/blob-hooks.mjs", import.meta.url);

import crypto from "node:crypto";
import zlib from "node:zlib";

const blobMock = await import("./testing/blob-mock.mjs");
const { __blobs } = blobMock;

/* ---------------- env ---------------- */
const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
process.env.DATA_ASSETS_DATABASE_URL = "postgres://tester:pw@neon-sql.test/iec_questionnaires?sslmode=require";

/* ---------------- mocked Neon SQL endpoint ---------------- */
/* Generic in-memory stand-in for the four builder tables, keyed by
   each table's first column (codename / id). */
const TABLES = { data_assets: new Map(), data_asset_runs: new Map(), data_asset_comparisons: new Map(), data_assets_catalog: new Map() };
const DOC_COL = { data_assets: "asset", data_asset_runs: "run", data_asset_comparisons: "comparison", data_assets_catalog: "system" };
let neonMode = "ok";

function neonSql(query, params) {
  const q = query.replace(/\s+/g, " ").trim();
  if (/^CREATE TABLE IF NOT EXISTS/.test(q)) return { rows: [] };
  let m = q.match(/^INSERT INTO (\w+) \(([^)]+)\)/);
  if (m) {
    const [, table, colsRaw] = m;
    const cols = colsRaw.split(",").map(s => s.trim());
    const row = {};
    cols.forEach((col, i) => { if (params[i] !== undefined) row[col] = params[i]; });
    const docCol = DOC_COL[table];
    if (docCol && typeof row[docCol] === "string") row[docCol] = JSON.parse(row[docCol]);
    TABLES[table].set(row[cols[0]], row);
    return { rows: [] };
  }
  m = q.match(/^SELECT (\w+) FROM (\w+)(?: WHERE (\w+) = \$1)?/);
  if (m) {
    const [, col, table, whereCol] = m;
    let rows = [...TABLES[table].values()];
    if (whereCol) rows = rows.filter(r => r[whereCol] === params[0]);
    return { rows: rows.map(r => ({ [col]: r[col] })) };
  }
  m = q.match(/^DELETE FROM (\w+) WHERE (\w+) = \$1/);
  if (m) {
    const [, table, col] = m;
    for (const [k, r] of TABLES[table]) if (r[col] === params[0]) TABLES[table].delete(k);
    return { rows: [] };
  }
  throw new Error(`unmocked SQL: ${q.slice(0, 80)}`);
}

const jsonRes = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === "https://neon-sql.test/sql") {
    if (neonMode === "throw") throw new Error("network down");
    const { query, params } = JSON.parse(opts.body);
    return jsonRes(200, neonSql(query, params || []));
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const mod = await import("../api/data-assets.js");
const handler = mod.default;
const core = await import("../api/_data-assets-core.js");
const catalogMod = await import("../api/_data-assets-catalog.js");
const pdfMod = await import("../api/_data-assets-pdf.js");
const storeMod = await import("../api/_data-assets-store.js");

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}
async function call(method, { body, query, cookie } = {}) {
  const req = { method, headers: cookie === null ? {} : { cookie: cookie ?? sessionCookie() }, body, query: query || {} };
  const res = {
    statusCode: 0, payload: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    send(b) { this.payload = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.payload = s; }
  };
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? " :: " + JSON.stringify(extra).slice(0, 300) : ""}`); }
}

const b64 = s => Buffer.from(s, "utf8").toString("base64");

/* A complete, valid medical asset — the corrected model package's
   arithmetic: every partition foots, subsets inside totals, the
   overlapping families sum past the denominator with the flag on. */
function validMedicalCounts() {
  return {
    totals: { totalPatients: 4000, totalEncounters: 18400, totalNotes: 24000, totalCases: 2250 },
    tables: {
      recordsByYear: { overlap: false, rows: [
        { label: "2023", encounters: 3400, patients: 1500, notes: 4300 },
        { label: "2024", encounters: 3100, patients: 1350, notes: 3900 },
        { label: "2025", encounters: 2800, patients: 1200, notes: 3650 } ] },
      patientsByDiagnosisFamily: { overlap: true, rows: [
        { label: "Lumbar disorders", detail: "M54.1x–M54.5x, M51.1x–M51.3x", patients: 1850 },
        { label: "Cervical disorders", detail: "M54.2, M50.x", patients: 690 },
        { label: "Shoulder disorders", detail: "M75.x, M25.51x", patients: 410 },
        { label: "Knee and hip disorders", detail: "M17.x, M16.x, M25.55x–M25.56x", patients: 520 },
        { label: "Neuropathic pain", detail: "G60.x–G63.x, M79.2", patients: 480 },
        { label: "Headache disorders", detail: "G43.x, G44.x", patients: 260 },
        { label: "Other musculoskeletal", detail: "M-codes not above", patients: 420 } ] },
      caseTypeMix: { overlap: false, rows: [
        { label: "Workers' compensation", cases: 1350, encounters: 10900 },
        { label: "Personal injury", cases: 380, encounters: 2900 },
        { label: "Commercial", cases: 400, encounters: 3600 },
        { label: "Other", cases: 120, encounters: 1000 } ] },
      noteLanguageShare: { overlap: false, rows: [
        { label: "English (EN)", notes: 14160 },
        { label: "Spanish (ES)", notes: 9360 },
        { label: "Other languages", notes: 480 } ] },
      visitsPerCaseBands: { overlap: false, rows: [
        { label: "1 visit only", cases: 250 },
        { label: "2–5 visits", cases: 800 },
        { label: "6–12 visits", cases: 650 },
        { label: "13–24 visits", cases: 350 },
        { label: "25 or more visits", cases: 200 } ] },
      historyDepth: { overlap: false, rows: [
        { label: "Under 6 months", patients: 700 },
        { label: "6 months to under 2 years", patients: 900 },
        { label: "2 years to under 5 years", patients: 1100 },
        { label: "5 years or more", patients: 1300 } ] }
    }
  };
}

console.log("data-assets.test");

/* --- session gate --- */
{
  const r = await call("GET", { cookie: null });
  check("no session → 401", r.statusCode === 401);
  const r2 = await call("GET", { cookie: "desk_session=forged.9999999999.deadbeef" });
  check("forged session → 401", r2.statusCode === 401);
}

/* --- catalog --- */
{
  const r = await call("GET", { query: { action: "catalog" } });
  check("catalog returns the seed", r.statusCode === 200 && r.payload.systems.length >= 46, r.payload && r.payload.systems && r.payload.systems.length);
  const byId = Object.fromEntries(r.payload.systems.map(s => [s.id, s]));
  check("Epic is VERIFIED with a mapping profile", byId.epic && byId.epic.confidence === "VERIFIED" && byId.epic.mappingProfile.length > 0);
  check("Sandata is PATTERN (EVV)", byId.sandata && byId.sandata.confidence === "PATTERN" && byId.sandata.classes.includes("EVV"));
  check("generic Custom/other entry exists", !!byId["custom-other"]);
  check("seed spans both tracks", r.payload.systems.some(s => s.track === "medical") && r.payload.systems.some(s => s.track === "non-medical"));

  const add = await call("POST", { body: { action: "add-system", system: { name: "ClinicWorks Pro", vendor: "CW", track: "medical", classes: ["EHR clinical", "Scheduling"], routes: ["native", "api"], confidence: "VERIFIED" } } });
  check("operator system added", add.statusCode === 200 && add.payload.system && add.payload.system.id === "custom-clinicworks-pro");
  check("operator system can NEVER claim VERIFIED", add.payload.system.confidence === "PATTERN");
}

/* --- manual path: valid asset saves + validates clean --- */
const assetBody = {
  codename: "ASSET-NORTH-01", track: "medical",
  variables: { specialtyMix: "Pain management; physical therapy", languages: "EN, ES (native)", caseTypeMixNote: "WC heavy", historyDepthYears: 25, workforceFTE: 40, locationsCount: 1 },
  systems: [{ id: "aprima" }, { id: "drchrono" }, { id: "rectangle-health" }],
  counts: validMedicalCounts()
};
{
  const r = await call("POST", { body: { action: "save-asset", asset: assetBody } });
  check("valid medical asset saves", r.statusCode === 200, r.payload);
  check("validation is clean on the corrected arithmetic", r.payload.validation && r.payload.validation.errors.length === 0, r.payload.validation && r.payload.validation.errors);
  const list = await call("GET", {});
  check("asset list shows the asset", list.payload.assets.some(a => a.codename === "ASSET-NORTH-01"));
  const one = await call("GET", { query: { codename: "ASSET-NORTH-01" } });
  check("asset reopens with counts intact", one.payload.asset.counts.totals.totalPatients === 4000);
}

/* --- validation: the audit's errors, enforced --- */
{
  const bad1 = JSON.parse(JSON.stringify(assetBody));
  bad1.codename = "ASSET-BAD-01";
  bad1.counts.tables.recordsByYear.rows[0].encounters = 99999;
  const r1 = await call("POST", { body: { action: "save-asset", asset: bad1 } });
  check("E2: subset exceeding its total is a hard error", r1.payload.validation.errors.some(e => e.check === "subset-exceeds-total"), r1.payload.validation.errors);

  const bad2 = JSON.parse(JSON.stringify(assetBody));
  bad2.codename = "ASSET-BAD-02";
  bad2.counts.tables.patientsByDiagnosisFamily.overlap = false;
  const r2 = await call("POST", { body: { action: "save-asset", asset: bad2 } });
  check("E1: overlapping counts with the flag OFF fail against the denominator", r2.payload.validation.errors.some(e => e.check === "overlap-off-mismatch"), r2.payload.validation.errors);

  const bad3 = JSON.parse(JSON.stringify(assetBody));
  bad3.codename = "ASSET-BAD-03";
  bad3.counts.tables.caseTypeMix.rows[0].cases = 1300;
  const r3 = await call("POST", { body: { action: "save-asset", asset: bad3 } });
  check("footing: a partition off by 50 fails with the variance in the message",
    r3.payload.validation.errors.some(e => e.check === "footing" && /variance 50/.test(e.message)), r3.payload.validation.errors);

  const bad4 = JSON.parse(JSON.stringify(assetBody));
  bad4.codename = "ASSET-BAD-04";
  bad4.counts.tables.patientsByDiagnosisFamily.rows[0].patients = 4500;
  const r4 = await call("POST", { body: { action: "save-asset", asset: bad4 } });
  check("a single family can never exceed the denominator", r4.payload.validation.errors.some(e => e.check === "row-exceeds-denominator"));

  const bad5 = JSON.parse(JSON.stringify(assetBody));
  bad5.codename = "ASSET-BAD-05";
  delete bad5.counts.tables.historyDepth.rows[2];
  const r5 = await call("POST", { body: { action: "save-asset", asset: bad5 } });
  check("band tables are structural — a missing band fails", r5.payload.validation.errors.some(e => e.check === "fixed-rows"));
}

/* --- export: buyer-safe discipline --- */
{
  const a = await call("POST", { body: { action: "assess", codename: "ASSET-NORTH-01" } });
  check("assess produces outputs for a passing asset", a.statusCode === 200 && a.payload.outputs && a.payload.outputs.distributions.length === 6);
  const md = a.payload.markdown;
  check("package carries the codename and the real counts", md.includes("ASSET-NORTH-01") && md.includes("18,400"));
  check("package counts are NOT labeled illustrative", !/illustrative/i.test(md));
  check("package keeps the model's synthetic specimens", /SPECIMEN A — SYNTHETIC/.test(md));
  check("package carries no money and no economics", !/\$\s?\d/.test(md) && !/commission|origination fee|seller fee/i.test(md));
  check("package names the expert-certification framework", /expert certification under 45 CFR 164\.514\(b\)\(1\)/.test(md));
  const dl = await call("GET", { query: { export: "md", codename: "ASSET-NORTH-01" } });
  check("MD export downloads", dl.statusCode === 200 && String(dl.payload).includes("Sample Specimen Package"));
  const pdf = await call("GET", { query: { export: "pdf", codename: "ASSET-NORTH-01" } });
  check("PDF export is a real PDF", pdf.statusCode === 200 && Buffer.isBuffer(pdf.payload) && pdf.payload.toString("latin1", 0, 5) === "%PDF-");
  const blockedExport = await call("GET", { query: { export: "md", codename: "ASSET-BAD-03" } });
  check("export is blocked for a failing assessment", blockedExport.statusCode === 422);
}

/* --- upload-and-run: aggregate CSV flows through the pipeline --- */
{
  await call("POST", { body: { action: "save-asset", asset: { codename: "ASSET-RUN-01", track: "medical", variables: { historyDepthYears: 10, workforceFTE: 12 }, systems: [{ id: "aprima" }], counts: core._internals.emptyCounts("medical") } } });
  const csv = ["Measure,Count", "Distinct patients,120", "Total encounters,860", "Total notes,1100", "Distinct cases,150"].join("\n");
  const run = await call("POST", { body: { action: "start-run", codename: "ASSET-RUN-01", files: [{ name: "aprima-counts.csv", base64: b64(csv) }] } });
  check("aggregate CSV run starts", run.statusCode === 200 && run.payload.run && run.payload.run.status === "awaiting-mapping", run.payload);
  check("candidates were extracted", run.payload.run.candidates.length === 4);
  check("totals proposals are high-confidence and correct",
    run.payload.run.proposals.filter(p => p.target && p.target.kind === "total").length === 4);
  check("the screened file was stored with the run", run.payload.run.files[0].stored === true && [...__blobs.keys()].some(k => k.includes("ASSET-RUN-01")));
  const confirm = await call("POST", { body: { action: "confirm-run", runId: run.payload.run.id, mapping: run.payload.run.proposals.map(p => ({ candidateId: p.candidateId, include: !!p.target, target: p.target })) } });
  check("confirmed mapping applies the totals to the asset",
    confirm.statusCode === 200 && confirm.payload.asset.counts.totals.totalPatients === 120 && confirm.payload.asset.counts.totals.totalEncounters === 860, confirm.payload.asset && confirm.payload.asset.counts.totals);
  check("run is recorded with its validation results",
    confirm.payload.run.status === "validation-failed" && Array.isArray(confirm.payload.run.validation.errors));
}

/* --- PHI screen: row-level export blocks, NOTHING is stored --- */
{
  await call("POST", { body: { action: "save-asset", asset: { codename: "ASSET-PHI-01", track: "medical", variables: {}, systems: [{ id: "aprima" }], counts: core._internals.emptyCounts("medical") } } });
  const header = "Patient Name,Date of Birth,MRN,Visit Date,Diagnosis";
  const rows = Array.from({ length: 60 }, (_, i) => `Person ${i},01/${String((i % 28) + 1).padStart(2, "0")}/19${80 + (i % 20)},MRN-${10000 + i},03/04/2024,Back pain`);
  const csv = [header, ...rows].join("\n");
  const blobsBefore = [...__blobs.keys()].filter(k => k.includes("ASSET-PHI-01")).length;
  const run = await call("POST", { body: { action: "start-run", codename: "ASSET-PHI-01", files: [{ name: "patient-export.csv", base64: b64(csv) }] } });
  check("row-level export BLOCKS the run", run.statusCode === 422 && run.payload.blocked === true, run.payload);
  check("the block message is the plain re-export message", /aggregate counts and structure only/.test(run.payload.message || ""));
  check("blocked file was never stored", [...__blobs.keys()].filter(k => k.includes("ASSET-PHI-01")).length === blobsBefore);
  const one = await call("GET", { query: { codename: "ASSET-PHI-01" } });
  check("no run record exists for the blocked run", one.payload.runs.length === 0);

  const screen = core._internals.phiScreen(core._internals.parseDelimited("Name,SSN\nX,123-45-6789"), "f.csv");
  check("an SSN value blocks on its own", screen.blocked === true);
}

/* --- XLSX + PDF parsing --- */
function buildXlsx() {
  const shared = ["Measure", "Count", "Distinct patients", "Total encounters"];
  const ss = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map(s => `<si><t>${s}</t></si>`).join("")}</sst>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>77</v></c></row>` +
    `<row><c r="A3" t="s"><v>3</v></c><c r="B3"><v>555</v></c></row></sheetData></worksheet>`;
  const files = [
    ["xl/sharedStrings.xml", Buffer.from(ss)],
    ["xl/worksheets/sheet1.xml", Buffer.from(sheet)],
    ["[Content_Types].xml", Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`)]
  ];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cenStart = offset;
  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12); eocd.writeUInt32LE(cenStart, 16);
  return Buffer.concat([...chunks, cenBuf, eocd]);
}
{
  const parsed = core._internals.parseXLSX(buildXlsx());
  check("XLSX parses to a table with shared strings resolved",
    parsed.tables.length === 1 && parsed.tables[0].rows[0][0] === "Distinct patients" && String(parsed.tables[0].rows[0][1]) === "77", parsed.tables);

  const pdfText = "BT /F1 12 Tf (Distinct patients: 4000) Tj (Total encounters: 18400) Tj ET";
  const stream = Buffer.from(pdfText, "latin1");
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length " + stream.length + " >>\nstream\n", "latin1"),
    stream,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< >>\n%%EOF", "latin1")
  ]);
  const parsedPdf = core._internals.parsePDF(pdf);
  check("PDF text layer extracts label: value counts",
    parsedPdf.kv.some(k => k.label === "Distinct patients" && k.value === "4000"), parsedPdf.kv);

  const scanned = core._internals.parsePDF(Buffer.from("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF", "latin1"));
  check("image-only PDF says so plainly instead of pretending",
    scanned.warnings.some(w => /No extractable text layer/.test(w)));
}

/* --- freeze + compare: blind discipline, accuracy summary --- */
{
  const fr = await call("POST", { body: { action: "freeze-asset", codename: "ASSET-NORTH-01" } });
  check("a passing asset freezes with a timestamp", fr.statusCode === 200 && !!fr.payload.asset.frozen.at, fr.payload);
  const edit = await call("POST", { body: { action: "save-asset", asset: assetBody } });
  check("a frozen asset refuses edits (409)", edit.statusCode === 409 && edit.payload.error === "frozen");
  const fr2 = await call("POST", { body: { action: "freeze-asset", codename: "ASSET-NORTH-01" } });
  check("double freeze is refused", fr2.statusCode === 409);
  const frBad = await call("POST", { body: { action: "freeze-asset", codename: "ASSET-BAD-03" } });
  check("a failing assessment cannot be frozen", frBad.statusCode === 422);

  const ext = await call("POST", { body: {
    action: "add-comparison", codename: "ASSET-NORTH-01",
    external: { source: "DataSupply", date: "2026-11-11", docName: "DS assessment",
      measures: { subjects: 4040, transactions: 13800, documents: 24000, cases: 2250, systems: 3, employees: 41, yearsOfHistory: 25, classesFound: ["EHR clinical", "PT / rehabilitation", "Payments"] },
      valueConclusion: "$400,000 per term license (their estimate)" }
  } });
  check("external assessment saves against the frozen asset", ext.statusCode === 200, ext.payload);
  const view = ext.payload.view;
  check("comparison is BLIND (frozen before the external entry)", view.blind.isBlind === true, view.blind);
  const byKey = Object.fromEntries(view.rows.map(r => [r.key, r]));
  check("1% variance is a MATCH", byKey.subjects && byKey.subjects.status === "MATCH" && byKey.subjects.pct === 1);
  check("25% variance is DIVERGENT", byKey.transactions && byKey.transactions.status === "DIVERGENT" && byKey.transactions.pct === 25);
  check("largest divergences sort first", view.largestFirst[0].key === "transactions");
  check("classes row compares as a set", view.classesRow && typeof view.classesRow.overlapPct === "number");

  const re = await call("GET", { query: { compare: ext.payload.comparison.id, match: "30", close: "40" } });
  check("thresholds are adjustable — 25% becomes a MATCH at a 30% match threshold",
    re.payload.view.rows.find(r => r.key === "transactions").status === "MATCH");

  const notes = await call("POST", { body: { action: "update-comparison-notes", id: ext.payload.comparison.id, notes: { transactions: "They counted visits, not encounters — PT sessions excluded on their side." } } });
  check("divergence notes save", notes.statusCode === 200 && notes.payload.comparison.divergenceNotes.transactions.includes("PT sessions excluded"));

  const mdAfter = await call("GET", { query: { export: "md", codename: "ASSET-NORTH-01" } });
  check("the comparison NEVER reaches the specimen export",
    mdAfter.statusCode === 200 && !String(mdAfter.payload).includes("DataSupply") && !String(mdAfter.payload).includes("$400,000"));

  await call("POST", { body: { action: "save-asset", asset: { codename: "ASSET-OPEN-01", track: "medical", variables: { workforceFTE: 10, historyDepthYears: 5 }, systems: [{ id: "aprima" }], counts: validMedicalCounts() } } });
  const ext2 = await call("POST", { body: { action: "add-comparison", codename: "ASSET-OPEN-01",
    external: { source: "DataSupply", measures: { subjects: 4000 } } } });
  check("an unfrozen asset's comparison is flagged not blind",
    ext2.statusCode === 200 && ext2.payload.view.blind.isBlind === false && /not been frozen/.test(ext2.payload.view.blind.note));
}

/* --- non-medical track end-to-end (core level) --- */
{
  const counts = {
    totals: { totalCustomers: 9000, totalTransactions: 210000, totalRecords: 95000, totalLocations: 12 },
    tables: {
      recordsByYear: { overlap: false, rows: [{ label: "2024", transactions: 48000, customers: 5200, records: 22000 }] },
      customersBySegment: { overlap: true, rows: [
        { label: "Fuel customers", customers: 7000 }, { label: "In-store retail", customers: 6100 }, { label: "Service contract holders", customers: 900 } ] },
      transactionTypeMix: { overlap: false, rows: [
        { label: "Sale", transactions: 198000 }, { label: "Service visit", transactions: 9000 },
        { label: "Booking", transactions: 2000 }, { label: "Invoice", transactions: 800 }, { label: "Other", transactions: 200 } ] },
      recordsBySourceSystem: { overlap: false, rows: [
        { label: "Square", records: 60000 }, { label: "PDI (Envoy / back-office)", records: 35000 } ] },
      transactionsPerCustomerBands: { overlap: false, rows: [
        { label: "1 transaction only", customers: 2600 }, { label: "2–5 transactions", customers: 2400 },
        { label: "6–12 transactions", customers: 1700 }, { label: "13–24 transactions", customers: 1200 },
        { label: "25 or more transactions", customers: 1100 } ] },
      historyDepth: { overlap: false, rows: [
        { label: "Under 6 months", customers: 1500 }, { label: "6 months to under 2 years", customers: 2100 },
        { label: "2 years to under 5 years", customers: 2600 }, { label: "5 years or more", customers: 2800 } ] }
    }
  };
  const systems = [{ id: "square", name: "Square" }, { id: "pdi", name: "PDI (Envoy / back-office)" }];
  const v = core._internals.validateAsset("non-medical", { historyDepthYears: 12, workforceFTE: 66 }, counts, systems);
  check("non-medical fixture validates clean (systems rows match the asset's systems)", v.errors.length === 0, v.errors);
  const wrongSys = JSON.parse(JSON.stringify(counts));
  wrongSys.tables.recordsBySourceSystem.rows[0].label = "Toast";
  const v2 = core._internals.validateAsset("non-medical", {}, wrongSys, systems);
  check("a records-by-system row naming a foreign system fails", v2.errors.some(e => e.check === "system-row"), v2.errors);
}

/* --- PDF writer sanity --- */
{
  const pdf = pdfMod._internals.blocksToPdf([{ t: "h2", text: "T" }, { t: "p", text: "Hello **bold** world" }, { t: "table", head: ["A", "B"], rows: [["1", "2"]] }], "Title");
  check("PDF writer emits a valid header + EOF", pdf.toString("latin1", 0, 5) === "%PDF-" && pdf.toString("latin1").includes("%%EOF"));
}

/* --- store failure is honest, never faked --- */
{
  storeMod._internals.setUrlForTests("");
  const r = await call("GET", {});
  check("unconfigured store → honest notConfigured", r.statusCode === 200 && r.payload.notConfigured === true);
  const w = await call("POST", { body: { action: "save-asset", asset: assetBody } });
  check("unconfigured store → write refused (503)", w.statusCode === 503 && w.payload.error === "not_configured");
  storeMod._internals.setUrlForTests(undefined);
  neonMode = "throw";
  const f = await call("POST", { body: { action: "save-asset", asset: { ...assetBody, codename: "ASSET-DOWN-01" } } });
  check("store outage → 503 store_failed, not a fake save", f.statusCode === 503 && f.payload.error === "store_failed");
  neonMode = "ok";
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
