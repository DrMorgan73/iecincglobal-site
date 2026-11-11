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

/* --- Stage 2: expert assessment layer --- */
{
  const catalogById = new Map(catalogMod.SEED_CATALOG.map(s => [s.id, s]));
  const x = await call("POST", { body: { action: "expert-assessment", codename: "ASSET-NORTH-01", smallCellThreshold: 11 } });
  check("Stage 2 expert assessment returns for a passing medical asset", x.statusCode === 200 && x.payload.expert && x.payload.expert.drivers.length === 8, x.payload);
  const byKey = Object.fromEntries(x.payload.expert.drivers.map(d => [d.key, d]));
  check("Stage 2: every driver carries evidence, including INSUFFICIENT DATA drivers",
    x.payload.expert.drivers.every(d => Array.isArray(d.evidence) && d.evidence.length > 0), x.payload.expert.drivers);
  check("Stage 2: volume evidence cites the exact stored totals",
    byKey.volume.status === "MID" && byKey.volume.evidence.join(" ").includes("4,000") && byKey.volume.evidence.join(" ").includes("18,400"), byKey.volume);
  check("Stage 2: longitudinal evidence computes the stored 2+ year share",
    byKey.longitudinalDepth.status === "STRONG" && byKey.longitudinalDepth.evidence.join(" ").includes("60%"), byKey.longitudinalDepth);
  check("Stage 2: uniqueness evidence uses the native non-English share",
    byKey.uniquenessScarcity.status === "STRONG" && byKey.uniquenessScarcity.evidence.join(" ").includes("41%"), byKey.uniquenessScarcity);
  check("Stage 2: terms are INSUFFICIENT DATA because Stage 1 stores no owner-terms fields",
    byKey.terms.status === "INSUFFICIENT DATA" && byKey.terms.missing.includes("Buyer categories allowed / banned") && byKey.terms.evidence.length > 0, byKey.terms);
  check("Stage 2: readiness is a verdict with a gap list",
    ["READY", "READY WITH GAPS", "NOT READY"].includes(x.payload.expert.readiness.verdict) && Array.isArray(x.payload.expert.readiness.gaps));
  check("Stage 2: quality analysis includes a per-system standardization read",
    x.payload.expert.quality.findings.some(f => f.category === "Standardization" && /Aprima/.test(f.finding) && /no source coded-field percentage is claimed/i.test(f.evidence.join(" "))), x.payload.expert.quality.findings);

  const emptyExpert = core._internals.analyzeExpertAssessment({
    codename: "ASSET-EMPTY-EXPERT", track: "medical", variables: {}, systems: [],
    counts: core._internals.emptyCounts("medical")
  }, catalogById);
  check("Stage 2: missing inputs score INSUFFICIENT DATA, never a guessed number",
    ["volume", "history", "longitudinalDepth", "standardization", "completenessQuality", "deidentificationReadiness"].every(k =>
      emptyExpert.drivers.find(d => d.key === k).status === "INSUFFICIENT DATA" &&
      emptyExpert.drivers.find(d => d.key === k).score === null &&
      emptyExpert.drivers.find(d => d.key === k).evidence.length > 0), emptyExpert.drivers);

  const smallBody = JSON.parse(JSON.stringify(assetBody));
  smallBody.codename = "ASSET-SMALL-01";
  smallBody.counts.tables.noteLanguageShare.rows = [
    { label: "English (EN)", notes: 14635 },
    { label: "Spanish (ES)", notes: 9360 },
    { label: "Other languages", notes: 5 }
  ];
  smallBody.counts.tables.patientsByDiagnosisFamily.rows.find(r => r.label === "Headache disorders").patients = 7;
  smallBody.counts.tables.patientsByDiagnosisFamily.rows.find(r => r.label === "Other musculoskeletal").patients = 673;
  const savedSmall = await call("POST", { body: { action: "save-asset", asset: smallBody } });
  check("Stage 2 small-cell fixture saves clean", savedSmall.statusCode === 200 && savedSmall.payload.validation.errors.length === 0, savedSmall.payload);
  const small = await call("POST", { body: { action: "expert-assessment", codename: "ASSET-SMALL-01", smallCellThreshold: 11 } });
  check("Stage 2: cells below 11 are flagged with table, row, measure and count",
    small.payload.expert.riskPack.smallCells.some(c => c.table === "noteLanguageShare" && c.row === "Other languages" && c.count === 5) &&
    small.payload.expert.riskPack.smallCells.some(c => c.table === "patientsByDiagnosisFamily" && c.row === "Headache disorders" && c.count === 7), small.payload.expert.riskPack.smallCells);
  check("Stage 2: rare combinations are marginal upper-bound flags, not invented cross-tabs",
    small.payload.expert.riskPack.rareCombinations.length > 0 &&
    small.payload.expert.riskPack.rareCombinations.every(c => c.upperBound < 11 && /Marginal upper bound only/.test(c.basis)), small.payload.expert.riskPack.rareCombinations.slice(0, 2));
  const smallAt5 = await call("POST", { body: { action: "expert-assessment", codename: "ASSET-SMALL-01", smallCellThreshold: 5 } });
  check("Stage 2: the small-cell threshold is adjustable",
    !smallAt5.payload.expert.riskPack.smallCells.some(c => c.count === 5 || c.count === 7) && smallAt5.payload.expert.riskPack.smallCellThreshold === 5);

  const report = await call("GET", { query: { expertReport: "md", codename: "ASSET-NORTH-01" } });
  check("Stage 2 internal report downloads as MD with scores, verdict and evidence",
    report.statusCode === 200 && String(report.payload).includes("Expert Assessment Report — INTERNAL ONLY") &&
    String(report.payload).includes("Driver scores") && String(report.payload).includes("Readiness verdict"), report.payload && String(report.payload).slice(0, 200));
  const reportPdf = await call("GET", { query: { expertReport: "pdf", codename: "ASSET-NORTH-01" } });
  check("Stage 2 internal report PDF is real and watermarked INTERNAL ONLY",
    reportPdf.statusCode === 200 && Buffer.isBuffer(reportPdf.payload) && reportPdf.payload.toString("latin1", 0, 5) === "%PDF-" &&
    reportPdf.payload.toString("latin1").includes("(INTERNAL ONLY)"));

  const noExpert = await call("POST", { body: { action: "generate-expert-determination", codename: "ASSET-NORTH-01", expert: { expertName: "", credentials: "", reviewDate: "" } } });
  check("determination draft refuses to generate without expert name, credentials and date",
    noExpert.statusCode === 400 && noExpert.payload.error === "expert_required", noExpert.payload);
  const gen = await call("POST", { body: { action: "generate-expert-determination", codename: "ASSET-NORTH-01",
    expert: { expertName: "Dr. Test Expert", credentials: "PhD, Biostatistics", reviewDate: "2026-11-11", smallCellThreshold: 11 } } });
  check("determination draft records the named expert, credentials and date — as a DRAFT",
    gen.statusCode === 200 && gen.payload.draft.status === "DRAFT — FOR EXPERT REVIEW AND SIGNATURE" &&
    gen.payload.draft.expertName === "Dr. Test Expert" && gen.payload.draft.credentials === "PhD, Biostatistics" && gen.payload.draft.reviewDate === "2026-11-11", gen.payload);
  check("determination draft is labeled in the document and never states certification",
    (gen.payload.determinationMarkdown.match(/DRAFT — FOR EXPERT REVIEW AND SIGNATURE/g) || []).length >= 3 &&
    gen.payload.determinationMarkdown.includes("NOT CERTIFIED") &&
    gen.payload.determinationMarkdown.includes("The system has not made the determination"), gen.payload.determinationMarkdown.slice(0, 500));
  const detPdf = await call("GET", { query: { expertDetermination: "pdf", codename: "ASSET-NORTH-01" } });
  check("determination draft PDF is real and watermarked DRAFT",
    detPdf.statusCode === 200 && Buffer.isBuffer(detPdf.payload) && detPdf.payload.toString("latin1", 0, 5) === "%PDF-" &&
    detPdf.payload.toString("latin1").includes("(DRAFT)"));
  const reopened = await call("GET", { query: { codename: "ASSET-NORTH-01" } });
  check("the expert draft record persists on the asset without any certified status",
    reopened.payload.asset.expertDraft && reopened.payload.asset.expertDraft.status === "DRAFT — FOR EXPERT REVIEW AND SIGNATURE" &&
    !/certified/i.test(reopened.payload.asset.expertDraft.status), reopened.payload.asset.expertDraft);

  const pkg = await call("GET", { query: { export: "md", codename: "ASSET-NORTH-01" } });
  check("buyer-safe export excludes ALL Stage 2 content after the expert layer is completed",
    pkg.statusCode === 200 && !String(pkg.payload).includes("Driver scores") && !String(pkg.payload).includes("READY WITH GAPS") &&
    !String(pkg.payload).includes("Dr. Test Expert") && !String(pkg.payload).includes("Expert Determination Draft") &&
    !String(pkg.payload).includes("Expert Assessment Report — INTERNAL ONLY"), String(pkg.payload).slice(0, 200));

  const { readFile } = await import("node:fs/promises");
  const ui = await readFile(new URL("../desk/data-builder.html", import.meta.url), "utf8");
  check("Desk UI carries the Stage 2 panel, the adjustable threshold and the DRAFT label",
    ui.includes("Stage 2 — Expert assessment (internal only)") && ui.includes('id="expert-threshold"') &&
    ui.includes("DRAFT — FOR EXPERT REVIEW AND SIGNATURE") && ui.includes("expert-assessment"));
  check("Desk UI has no workflow to mark a determination certified",
    !ui.includes('id="expert-certify"') && !/>Certify</.test(ui) && !ui.includes("mark-certified"));
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

  const catalogById = new Map(catalogMod.SEED_CATALOG.map(s => [s.id, s]));
  const nx = core._internals.analyzeExpertAssessment({
    codename: "ASSET-NONMED-EXPERT", track: "non-medical",
    variables: { historyDepthYears: 12, workforceFTE: 66 }, systems: ["square", "pdi"], counts
  }, catalogById);
  const workforce = nx.drivers.find(d => d.key === "workforceScale");
  check("Stage 2 non-medical track includes workforce scale as Driver 9, scored from the stored FTE",
    !!workforce && workforce.status === "STRONG" && workforce.evidence.join(" ").includes("66 full-time employees"), workforce);
  check("Stage 2 non-medical risk pack is the analogous modeled discipline pack",
    /modeled on the medical de-identification discipline/.test(nx.riskPack.kind) && nx.riskPack.framework.includes("164.514(b)(1)") &&
    nx.riskPack.retainedElements.some(r => r.element === "Coarse region code"), nx.riskPack);
  check("Stage 2 non-medical quality read is per selected system",
    nx.quality.metrics.perSystem.length === 2 && nx.quality.metrics.perSystem.some(s => s.name === "Square"), nx.quality.metrics.perSystem);
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

/* --- Proposer rework: synthetic-kit defects D1–D5, regression ---
   The kit cases (~/workspace/your_files/data-builder-test-kit-2026-11-11)
   inlined: TEST-PRACTICE-01 (medical), TEST-OPERATOR-01 (non-medical),
   and the broken practice whose PT row exceeds its total. */
const KIT_MED = {
  "test-practice-01-by-year.csv": "Year,Encounters,Patients,Notes\r\n2019,9800,4600,12100\r\n2022,11400,5300,14200\r\n2025,13100,5900,16300\r",
  "test-practice-01-case-mix.csv": "Case type,Cases,Encounters\r\nWorkers' compensation,5760,46800\r\nPersonal injury,1440,10920\r\nCommercial,1728,14820\r\nOther,672,5460\r",
  "test-practice-01-diagnosis-families.csv": "Diagnosis family,ICD-10-CM range,Patients\r\nLumbar disorders,\"M54.1x-M54.5x, M51.1x-M51.3x\",7050\r\nCervical disorders,\"M54.2, M50.x\",2625\r\nShoulder disorders,\"M75.x, M25.51x\",1575\r\nKnee and hip disorders,\"M17.x, M16.x, M25.55x-M25.56x\",1980\r\nNeuropathic pain,\"G60.x-G63.x, M79.2\",1830\r\nHeadache disorders,\"G43.x, G44.x\",990\r\nOther musculoskeletal,M-codes not above,1605\r",
  "test-practice-01-history-depth.csv": "History depth,Patients\r\nUnder 6 months,2250\r\n6 months to under 2 years,3300\r\n2 years to under 5 years,3900\r\n5 years or more,5550\r",
  "test-practice-01-note-language.csv": "Language,Notes\r\nEnglish (EN),57600\r\nSpanish (ES),36480\r\nOther languages,1920\r",
  "test-practice-01-records-by-system.csv": "Source system,Documents\r\nAprima,58200\r\nDrChrono,24600\r\nRectangle Health,13200\r",
  "test-practice-01-totals.csv": "Measure,Count\r\nDistinct patients,15000\r\nTotal encounters,78000\r\nTotal notes,96000\r\nDistinct cases,9600\r",
  "test-practice-01-visits-per-case.csv": "Visits per case,Cases\r\n1 visit only,960\r\n2-5 visits,2880\r\n6-12 visits,2690\r\n13-24 visits,1730\r\n25 or more visits,1340\r"
};
const KIT_OPS = {
  "test-operator-01-by-year.csv": "Year,Transactions,Customers,Records\r\n2021,61000,3100,39500\r\n2023,74500,3650,48200\r\n2025,88300,4050,57600\r",
  "test-operator-01-history-depth.csv": "History depth,Customers\r\nUnder 6 months,1260\r\n6 months to under 2 years,2180\r\n2 years to under 5 years,2470\r\n5 years or more,2490\r",
  "test-operator-01-per-customer-bands.csv": "Transactions per customer,Customers\r\n1 transaction only,1150\r\n2-5 transactions,1780\r\n6-12 transactions,1960\r\n13-24 transactions,1640\r\n25 or more transactions,1870\r",
  "test-operator-01-records-by-system.csv": "Source system,Records\r\nWellSky,171500\r\nSalesforce,58300\r\nMicrosoft 365,38200\r",
  "test-operator-01-segments.csv": "Segment,Definition,Customers\r\nMedicare home health clients,Certified home health episodes,5900\r\nMedicaid and waiver clients,State waiver programs,2300\r\nPrivate-duty and private-pay clients,Private pay personal care,1450\r\nRespite and companion clients,Companion and respite hours,680\r",
  "test-operator-01-totals.csv": "Measure,Count\r\nDistinct customers,8400\r\nTotal transactions,412000\r\nTotal records,268000\r\nTotal locations,4\r",
  "test-operator-01-transaction-mix.csv": "Transaction type,Transactions\r\nSale,12400\r\nService visit,356000\r\nBooking,28900\r\nInvoice,13700\r\nOther,1000\r"
};
const KIT_BRK = {
  "test-practice-broken-by-year.csv": "Year,Encounters,Patients,Notes\r\n2023,2300,640,2900\r\n2024,2600,720,3100\r",
  "test-practice-broken-case-mix.csv": "Case type,Cases,Encounters\r\nWorkers' compensation,186,3240\r\nPersonal injury,47,810\r\nCommercial,55,1030\r\nOther,22,320\r",
  "test-practice-broken-diagnosis-families.csv": "Diagnosis family,ICD-10-CM range,Patients\r\nLumbar disorders,M54.1x-M54.5x,520\r\nPhysical therapy patients,PT cohort - all programs,1850\r\nCervical disorders,\"M54.2, M50.x\",210\r",
  "test-practice-broken-history-depth.csv": "History depth,Patients\r\nUnder 6 months,240\r\n6 months to under 2 years,310\r\n2 years to under 5 years,350\r\n5 years or more,300\r",
  "test-practice-broken-note-language.csv": "Language,Notes\r\nEnglish (EN),4140\r\nSpanish (ES),2480\r\nOther languages,280\r",
  "test-practice-broken-totals.csv": "Measure,Count\r\nDistinct patients,1200\r\nTotal encounters,5400\r\nTotal notes,6900\r\nDistinct cases,310\r",
  "test-practice-broken-visits-per-case.csv": "Visits per case,Cases\r\n1 visit only,62\r\n2-5 visits,109\r\n6-12 visits,74\r\n13-24 visits,41\r\n25 or more visits,24\r"
};
{
  const P = core._internals.proposeMapping, A = core._internals.applyMapping;
  const cand = (id, rowLabel, columnLabel, extra) => ({ id, label: `${rowLabel} — ${columnLabel}`, value: 100, rowLabel, columnLabel, file: "export.csv", tableName: "Table 1", ...(extra || {}) });
  const targetOf = (track, c, systems) => P(track, [c], systems || [])[0].target;

  /* D1: the canonical WC label and its variants reach the WC row */
  for (const v of ["Workers' compensation", "Workers’ compensation", "Workers compensation", "Workers comp", "Work comp", "WC"]) {
    const tg = targetOf("medical", cand("x", v, "Cases"));
    check(`D1: "${v}" proposes the Workers' compensation row`, !!tg && tg.table === "caseTypeMix" && tg.row === "Workers' compensation" && tg.column === "cases", tg);
  }
  /* D3: all four canonical depth labels match their rows */
  for (const [label, row] of [["Under 6 months", "Under 6 months"], ["6 months to under 2 years", "6 months to under 2 years"], ["2 years to under 5 years", "2 years to under 5 years"], ["5 years or more", "5 years or more"]]) {
    const tg = targetOf("medical", cand("x", label, "Patients"));
    check(`D3: depth label "${label}" proposes its history-depth row`, !!tg && tg.table === "historyDepth" && tg.row === row, tg);
  }
  /* D2: band classification is unit-aware — a years span is never a visits band */
  {
    const tg = targetOf("medical", cand("x", "2 years to under 5 years", "Cases"));
    check("D2: a years span never lands in the visits bands", !!tg && tg.table === "historyDepth", tg);
    const tv = targetOf("medical", cand("x", "2-5 visits", "Cases"));
    check("D2: a visits band lands in the visits bands", !!tv && tv.table === "visitsPerCaseBands" && tv.row === "2–5 visits", tv);
    const tt = targetOf("non-medical", cand("x", "2-5 transactions", "Customers"));
    check("D2: a transactions band lands in the transactions bands", !!tt && tt.table === "transactionsPerCustomerBands" && tt.row === "2–5 transactions", tt);
    const tx = targetOf("medical", cand("x", "2-5 transactions", "Cases"));
    check("D2: a transactions label gets no visits proposal on the medical track", tx === null, tx);
  }
  /* D4: records-by-system rows get NO proposal on the medical track —
     by source file name, and by system name when the source is opaque */
  {
    const byName = targetOf("medical", cand("x", "Aprima", "Documents", { file: "test-practice-01-records-by-system.csv" }), [{ name: "Aprima" }]);
    check("D4: records-by-system row (named source) gets no proposal", byName === null, byName);
    const opaque = targetOf("medical", cand("x", "Aprima", "Documents", { file: "book.xlsx", tableName: "sheet5" }), [{ name: "Aprima" }]);
    check("D4: records-by-system row (opaque source) gets no proposal", opaque === null, opaque);
    const strict = targetOf("medical", cand("x", "Aprima", "Documents", { file: "notes.csv" }), []);
    check("D4: a foreign row never falls into the diagnosis table via the column fallback", strict === null, strict);
    const other = targetOf("medical", cand("x", "Other musculoskeletal", "Patients"));
    check("D4: 'Other musculoskeletal' is a diagnosis family, not a language/case 'Other'", !!other && other.table === "patientsByDiagnosisFamily", other);
  }
  /* Collision rule: canonical order, first wins — identical outcome
     in either mapping order, and the loser is named in the notes */
  {
    const cands = [
      { id: "c1", label: "Zeta — Count", value: 200 },
      { id: "c2", label: "Alpha — Count", value: 100 }
    ];
    const m = id => ({ candidateId: id, include: true, target: { kind: "total", key: "totalPatients" } });
    const fwd = A("medical", cands, [m("c1"), m("c2")]);
    const rev = A("medical", cands, [m("c2"), m("c1")]);
    check("collision rule is order-independent and keeps the canonical first entry",
      fwd.counts.totals.totalPatients === 100 && rev.counts.totals.totalPatients === 100 && fwd.notes.length === 1 && rev.notes.length === 1,
      { fwd: fwd.counts.totals, rev: rev.counts.totals, notes: fwd.notes });
  }
  /* D5 at the apply layer: the flag rides the mapping entry */
  {
    const cands = [{ id: "c1", label: "Lumbar disorders — Patients", value: 500, rowLabel: "Lumbar disorders", columnLabel: "Patients" }];
    const cellT = { kind: "cell", table: "patientsByDiagnosisFamily", row: "Lumbar disorders", column: "patients" };
    const withFlag = A("medical", cands, [{ candidateId: "c1", include: true, target: cellT, overlap: true }]);
    const without = A("medical", cands, [{ candidateId: "c1", include: true, target: cellT }]);
    check("D5: an overlap:true mapping entry sets the table's overlap flag",
      withFlag.counts.tables.patientsByDiagnosisFamily.overlap === true && without.counts.tables.patientsByDiagnosisFamily.overlap === false);
  }
}
/* D1–D5 end-to-end: TEST-PRACTICE-01 through the real API flow */
{
  await call("POST", { body: { action: "save-asset", asset: { codename: "KIT-MED-01", track: "medical",
    variables: { specialtyMix: "Pain management; physical therapy", languages: "EN, ES (native)", historyDepthYears: 25, workforceFTE: 42, locationsCount: 1 },
    systems: [{ id: "aprima" }, { id: "drchrono" }, { id: "rectangle-health" }], counts: core._internals.emptyCounts("medical") } } });
  const files = Object.entries(KIT_MED).map(([name, text]) => ({ name, base64: b64(text) }));
  const run = await call("POST", { body: { action: "start-run", codename: "KIT-MED-01", files } });
  check("kit medical run starts", run.statusCode === 200 && run.payload.run.status === "awaiting-mapping", run.payload);
  const props = run.payload.run.proposals, cands = run.payload.run.candidates;
  const byId = Object.fromEntries(cands.map(c => [c.id, c]));
  const tally = { high: 0, guess: 0, none: 0 };
  for (const p of props) tally[p.target ? p.confidence : "none"]++;
  check("kit proposals: 43 candidates at 24 high / 16 guess / 3 none (the README pattern)",
    cands.length === 43 && tally.high === 24 && tally.guess === 16 && tally.none === 3, tally);
  check("kit: every records-by-system candidate is unproposed",
    props.filter(p => (byId[p.candidateId].file || "").includes("records-by-system")).every(p => p.target === null));
  check("kit: the WC candidates land on the Workers' compensation row",
    props.filter(p => byId[p.candidateId].rowLabel === "Workers' compensation")
      .every(p => p.target && p.target.table === "caseTypeMix" && p.target.row === "Workers' compensation"));
  const plain = await call("POST", { body: { action: "confirm-run", runId: run.payload.run.id, mapping: props.map(p => ({ candidateId: p.candidateId, include: !!p.target, target: p.target })) } });
  check("kit Stage A: without the flag the ONLY error is the overlap artifact",
    plain.payload.run.status === "validation-failed" && plain.payload.run.validation.errors.length === 1 && plain.payload.run.validation.errors[0].check === "overlap-off-mismatch",
    plain.payload.run && plain.payload.run.validation);
  const run2 = await call("POST", { body: { action: "start-run", codename: "KIT-MED-01", files } });
  const props2 = run2.payload.run.proposals;
  const confirm2 = await call("POST", { body: { action: "confirm-run", runId: run2.payload.run.id, mapping: props2.map(p => ({
    candidateId: p.candidateId, include: !!p.target, target: p.target,
    ...(p.target && p.target.kind === "cell" && p.target.table === "patientsByDiagnosisFamily" ? { overlap: true } : {})
  })) } });
  check("D5 end-to-end: overlap confirmed on the upload path validates clean",
    confirm2.payload.run.status === "assessed" && confirm2.payload.run.validation.errors.length === 0, confirm2.payload.run && confirm2.payload.run.validation);
  check("D5 end-to-end: the applied table carries the flag",
    confirm2.payload.asset.counts.tables.patientsByDiagnosisFamily.overlap === true);
  const x = await call("POST", { body: { action: "expert-assessment", codename: "KIT-MED-01" } });
  const drv = Object.fromEntries((x.payload.expert ? x.payload.expert.drivers : []).map(d => [d.key, d.status]));
  check("kit medical expert outcome: READY WITH GAPS with the README driver pattern",
    x.payload.expert && x.payload.expert.readiness.verdict === "READY WITH GAPS" &&
    drv.volume === "STRONG" && drv.history === "STRONG" && drv.longitudinalDepth === "STRONG" &&
    drv.standardization === "MID" && drv.uniquenessScarcity === "STRONG" && drv.completenessQuality === "STRONG" &&
    drv.deidentificationReadiness === "STRONG" && drv.terms === "INSUFFICIENT DATA", drv);
}
/* D1–D5 end-to-end: TEST-OPERATOR-01 (non-medical) through the API flow */
{
  const added = await call("POST", { body: { action: "add-system", system: { name: "Microsoft 365" } } });
  const msId = added.payload.system && added.payload.system.id;
  check("kit operator: the operator-added system registers", !!msId, added.payload);
  await call("POST", { body: { action: "save-asset", asset: { codename: "KIT-OPS-01", track: "non-medical",
    variables: { languages: "EN, ES", historyDepthYears: 20, workforceFTE: 66, locationsCount: 4 },
    systems: [{ id: "wellsky" }, { id: "salesforce" }, { id: msId }], counts: core._internals.emptyCounts("non-medical") } } });
  const files = Object.entries(KIT_OPS).map(([name, text]) => ({ name, base64: b64(text) }));
  const run = await call("POST", { body: { action: "start-run", codename: "KIT-OPS-01", files } });
  check("kit operator run starts", run.statusCode === 200 && run.payload.run.status === "awaiting-mapping", run.payload);
  const props = run.payload.run.proposals, cands = run.payload.run.candidates;
  const byId = Object.fromEntries(cands.map(c => [c.id, c]));
  check("kit operator: records-by-system rows propose the records-by-system table at high confidence",
    props.filter(p => (byId[p.candidateId].file || "").includes("records-by-system"))
      .every(p => p.target && p.target.table === "recordsBySourceSystem" && p.confidence === "high") &&
    props.some(p => p.target && p.target.table === "recordsBySourceSystem"));
  const confirm = await call("POST", { body: { action: "confirm-run", runId: run.payload.run.id, mapping: props.map(p => ({
    candidateId: p.candidateId, include: !!p.target, target: p.target,
    ...(p.target && p.target.kind === "cell" && p.target.table === "customersBySegment" ? { overlap: true } : {})
  })) } });
  check("kit operator validates clean with overlap via upload",
    confirm.payload.run.status === "assessed" && confirm.payload.run.validation.errors.length === 0, confirm.payload.run && confirm.payload.run.validation);
  const x = await call("POST", { body: { action: "expert-assessment", codename: "KIT-OPS-01" } });
  const drv = Object.fromEntries((x.payload.expert ? x.payload.expert.drivers : []).map(d => [d.key, d.status]));
  check("kit operator expert outcome: READY WITH GAPS with the README driver pattern",
    x.payload.expert && x.payload.expert.readiness.verdict === "READY WITH GAPS" &&
    drv.volume === "MID" && drv.history === "STRONG" && drv.longitudinalDepth === "STRONG" &&
    drv.standardization === "WEAK" && drv.uniquenessScarcity === "STRONG" && drv.completenessQuality === "STRONG" &&
    drv.workforceScale === "STRONG" && drv.terms === "INSUFFICIENT DATA", drv);
}
/* Broken kit file: with the proposer fixed, the ONLY surviving error
   is the file's own defect, naming its figure */
{
  const docs = Object.entries(KIT_BRK).map(([name, text]) => ({ name, parsed: core._internals.parseDocument({ name, base64: b64(text) }) }));
  const cands = core._internals.extractCandidates(docs);
  const props = core._internals.proposeMapping("medical", cands, [{ name: "Aprima" }, { name: "DrChrono" }, { name: "Rectangle Health" }]);
  const applied = core._internals.applyMapping("medical", cands, props.map(p => ({
    candidateId: p.candidateId, include: !!p.target, target: p.target,
    ...(p.target && p.target.kind === "cell" && p.target.table === "patientsByDiagnosisFamily" ? { overlap: true } : {})
  })));
  const v = core._internals.validateAsset("medical", { historyDepthYears: 25, workforceFTE: 42 }, applied.counts, []);
  check("broken kit: exactly one error survives — the PT row naming 1,850",
    v.errors.length === 1 && v.errors[0].check === "row-exceeds-denominator" && /1,850/.test(v.errors[0].message), v.errors);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
