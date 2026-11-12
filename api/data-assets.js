/* =====================================================================
   /api/data-assets — IEC Suite "Data Asset Builder" (Desk-only).
   ---------------------------------------------------------------------
   Operationalizes IEC's model sample specimen package for both
   tracks (medical / non-medical). Primary path is UPLOAD-AND-RUN:
   parse → PHI screen (hard gate) → mapping proposal → operator
   confirms the mapping → validate → assess. Manual entry is the
   fallback and the edit path.

   COUNTS AND CODENAMES ONLY. Nothing here stores a patient or
   customer record: the PHI screen blocks row-level documents before
   anything is written, and a blocked file is never stored — no
   file, no tables, no run record. NO ECONOMICS anywhere: no fee,
   split, price or currency field exists in this API (an external
   party's own stated value conclusion may be recorded on a
   comparison, labeled as theirs, internal only, never exported).

   Storage: Neon (assets / runs / comparisons / custom catalog) via
   _data-assets-store.js; screened source files in the Office Blob
   store. When the store is not configured the API says so honestly
   (503 not_configured) — a save is never faked as stored.

   Comparisons are INTERNAL ONLY: the specimen-package export is
   built from the asset alone and can never contain them.
   ===================================================================== */

import crypto from "node:crypto";
import {
  assetsDbConfigured, listAssets, readAsset, writeAsset, deleteAsset,
  writeRun, readRun, listRuns, writeComparison, readComparison,
  listComparisons, deleteComparison, listCustomSystems, writeCustomSystem,
  filesConfigured, storeRunFile
} from "./_data-assets-store.js";
import { SEED_CATALOG, sanitizeCustomSystem } from "./_data-assets-catalog.js";
import {
  trackDef, validateAsset, emptyCounts, parseDocument, phiScreen, PHI_BLOCK_MESSAGE,
  extractCandidates, proposeMapping, applyMapping, assessAsset, compareAssessments,
  analyzeExpertAssessment, buildExpertReportDocument, buildExpertDeterminationDocument,
  renderMarkdown
} from "./_data-assets-core.js";
import { blocksToPdf } from "./_data-assets-pdf.js";

/* ------------------------------------------------------------------ */
/* Desk session verification — mirrors middleware.js / the other      */
/* Desk APIs exactly. A session is never forged here.                 */
/* ------------------------------------------------------------------ */

function hmacHex(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function getCookie(req, name) {
  const m = String(req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}
function validSession(req) {
  const secret = process.env.DESK_SESSION_SECRET || "";
  if (!secret) return false;
  const raw = getCookie(req, "desk_session");
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  return timingSafeEqual(hmacHex(secret, `${user}.${exp}`), sig);
}

/* ------------------------------------------------------------------ */
/* Sanitizers — server-side, always. Unknown fields are dropped;      */
/* counts are numbers or null; the asset's only identifier is its     */
/* codename (the form never asks for a real name).                    */
/* ------------------------------------------------------------------ */

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const numOrNull = v => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const newId = prefix => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;

function sanitizeCodename(v) {
  const s = str(v, 40);
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(s) ? s : null;
}

function sanitizeVariables(track, input) {
  const t = trackDef(track);
  const out = {};
  for (const vd of t.variables) {
    if (vd.type === "int") out[vd.key] = numOrNull(input && input[vd.key]);
    else out[vd.key] = str(input && input[vd.key], 200);
  }
  return out;
}

function sanitizeSystems(input, catalogById) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const item of input.slice(0, 24)) {
    const id = str(item && (item.id || item), 60);
    if (!id || seen.has(id)) continue;
    const cat = catalogById.get(id);
    if (!cat) continue;
    seen.add(id);
    out.push({ id: cat.id, name: cat.name });
  }
  return out;
}

function sanitizeCounts(track, input) {
  const t = trackDef(track);
  const counts = emptyCounts(track);
  const totalsIn = (input && input.totals) || {};
  for (const tot of t.totals) counts.totals[tot.key] = numOrNull(totalsIn[tot.key]);
  const tablesIn = (input && input.tables) || {};
  for (const td of t.tables) {
    const tin = tablesIn[td.id] || {};
    const rows = [];
    for (const r of (Array.isArray(tin.rows) ? tin.rows : []).slice(0, 80)) {
      if (!r || typeof r !== "object") continue;
      const row = { label: str(r.label, 80), detail: str(r.detail, 80) };
      for (const m of td.measure) row[m.key] = numOrNull(r[m.key]);
      rows.push(row);
    }
    counts.tables[td.id] = { overlap: tin.overlap === true, rows };
  }
  return counts;
}

function sanitizeAsset(input, catalogById, existing) {
  if (!input || typeof input !== "object") return null;
  const track = trackDef(input.track) ? input.track : null;
  const codename = sanitizeCodename(input.codename);
  if (!track || !codename) return null;
  const now = new Date().toISOString();
  return {
    codename,
    track,
    variables: sanitizeVariables(track, input.variables),
    systems: sanitizeSystems(input.systems, catalogById),
    counts: sanitizeCounts(track, input.counts),
    manualEdits: Array.isArray(input.manualEdits) ? input.manualEdits.map(s => str(s, 120)).slice(0, 200) : (existing ? existing.manualEdits || [] : []),
    countsSource: str(input.countsSource, 20) || (existing ? existing.countsSource : "manual"),
    lastRunId: str(input.lastRunId, 60) || (existing ? existing.lastRunId : null),
    expertDraft: existing && existing.track === track ? existing.expertDraft || null : null,
    frozen: existing ? existing.frozen || null : null,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
}

function sanitizeThreshold(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2 && n <= 100 ? n : 11;
}

function sanitizeExpertDraft(input) {
  if (!input || typeof input !== "object") return null;
  const expertName = str(input.expertName, 120);
  const credentials = str(input.credentials, 200);
  const reviewDate = str(input.reviewDate || input.date, 10);
  if (!expertName || !credentials || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) return null;
  const parsed = new Date(`${reviewDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== reviewDate) return null;
  return {
    status: "DRAFT — FOR EXPERT REVIEW AND SIGNATURE",
    expertName,
    credentials,
    reviewDate,
    generatedAt: new Date().toISOString(),
    smallCellThreshold: sanitizeThreshold(input.smallCellThreshold)
  };
}

function sanitizeExternal(input) {
  if (!input || typeof input !== "object") return null;
  const source = str(input.source, 60);
  if (!source) return null;
  const m = (input && input.measures) || {};
  const measures = {};
  for (const key of ["subjects", "transactions", "documents", "cases", "systems", "employees", "yearsOfHistory"]) {
    measures[key] = numOrNull(m[key]);
  }
  measures.classesFound = Array.isArray(m.classesFound)
    ? [...new Set(m.classesFound.map(c => str(c, 40)).filter(Boolean))].slice(0, 24) : [];
  return {
    source,
    date: str(input.date, 10),
    docName: str(input.docName, 120),
    measures,
    valueConclusion: str(input.valueConclusion, 300)
  };
}

function sanitizeMapping(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).map(m => {
    if (!m || typeof m !== "object") return null;
    const tgt = m.target;
    let target = null;
    if (tgt && tgt.kind === "total") target = { kind: "total", key: str(tgt.key, 40) };
    else if (tgt && tgt.kind === "cell") target = { kind: "cell", table: str(tgt.table, 40), row: str(tgt.row, 80), column: str(tgt.column, 40) };
    /* overlap: the operator's mapping-time confirmation that the
       target table's categories overlap (model §2.2) — carried
       through so applyMapping can set the table's flag on the
       upload path (kit defect D5). */
    return { candidateId: str(m.candidateId, 20), include: m.include !== false, target, overlap: m.overlap === true };
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Catalog (seed + operator-added), merged.                            */
/* ------------------------------------------------------------------ */

async function mergedCatalog() {
  const byId = new Map(SEED_CATALOG.map(s => [s.id, s]));
  let custom = [];
  if (assetsDbConfigured()) {
    try { custom = (await listCustomSystems()) || []; } catch (e) { custom = []; }
  }
  for (const sys of custom) if (sys && sys.id) byId.set(sys.id, sys);
  return { list: [...byId.values()], byId };
}

const summaryOf = a => ({
  codename: a.codename, track: a.track, updatedAt: a.updatedAt, createdAt: a.createdAt,
  frozen: a.frozen ? { at: a.frozen.at } : null,
  totals: a.counts ? a.counts.totals : {},
  systemsCount: (a.systems || []).length,
  validationErrors: a.lastValidation ? a.lastValidation.errors.length : null,
  countsSource: a.countsSource || "manual",
  expertDraft: a.expertDraft ? { status: a.expertDraft.status, generatedAt: a.expertDraft.generatedAt } : null
});

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (!validSession(req)) return res.status(401).json({ error: "unauthorized" });
  const { list, byId } = await mergedCatalog();
  const q = req.query || {};

  try {
    /* ------------------------- GET ------------------------- */
    if (req.method === "GET") {
      if (q.action === "catalog") {
        return res.status(200).json({ systems: list, seedCount: SEED_CATALOG.length });
      }
      if (q.expertReport) {
        const asset = assetsDbConfigured() ? await readAsset(str(q.codename, 40)) : null;
        if (!asset) return res.status(404).json({ error: "asset_not_found" });
        const expert = analyzeExpertAssessment(asset, byId, { smallCellThreshold: sanitizeThreshold(q.smallCellThreshold) });
        const document = buildExpertReportDocument(asset, expert);
        if (q.expertReport === "pdf") {
          const pdf = blocksToPdf(document, `Expert Assessment Report — INTERNAL ONLY — ${asset.codename}`, { watermark: "INTERNAL ONLY" });
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="expert-assessment-${asset.codename}.pdf"`);
          return res.status(200).send(pdf);
        }
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="expert-assessment-${asset.codename}.md"`);
        return res.status(200).send(renderMarkdown(document));
      }
      if (q.expertDetermination) {
        const asset = assetsDbConfigured() ? await readAsset(str(q.codename, 40)) : null;
        if (!asset) return res.status(404).json({ error: "asset_not_found" });
        if (asset.track !== "medical") return res.status(422).json({ error: "medical_only", message: "Expert determination drafts are available only on the medical track." });
        if (!asset.expertDraft) return res.status(422).json({ error: "expert_not_recorded", message: "Record the named qualified expert, credentials and review date before generating the draft." });
        const expert = analyzeExpertAssessment(asset, byId, { smallCellThreshold: asset.expertDraft.smallCellThreshold });
        const document = buildExpertDeterminationDocument(asset, expert, asset.expertDraft);
        if (q.expertDetermination === "pdf") {
          const pdf = blocksToPdf(document, `DRAFT — FOR EXPERT REVIEW AND SIGNATURE — ${asset.codename}`, { watermark: "DRAFT" });
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="expert-determination-DRAFT-${asset.codename}.pdf"`);
          return res.status(200).send(pdf);
        }
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="expert-determination-DRAFT-${asset.codename}.md"`);
        return res.status(200).send(renderMarkdown(document));
      }
      if (q.export) {
        const asset = assetsDbConfigured() ? await readAsset(str(q.codename, 40)) : null;
        if (!asset) return res.status(404).json({ error: "asset_not_found" });
        const { validation, markdown, document } = assessAsset(asset, byId);
        if (validation.errors.length) {
          return res.status(422).json({ error: "validation_failed", message: "The specimen package is generated only from an assessment that passes every check.", errors: validation.errors });
        }
        if (q.export === "pdf") {
          const pdf = blocksToPdf(document, `Sample Specimen Package — ${asset.codename}`);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="specimen-package-${asset.codename}.pdf"`);
          return res.status(200).send(pdf);
        }
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="specimen-package-${asset.codename}.md"`);
        return res.status(200).send(markdown);
      }
      if (q.compare) {
        const comparison = assetsDbConfigured() ? await readComparison(str(q.compare, 60)) : null;
        if (!comparison) return res.status(404).json({ error: "comparison_not_found" });
        const asset = await readAsset(comparison.codename);
        if (!asset) return res.status(404).json({ error: "asset_not_found" });
        const view = compareAssessments(asset, comparison, {
          matchPct: numOrNull(q.match), closePct: numOrNull(q.close)
        }, byId);
        return res.status(200).json({ comparison, view });
      }
      if (q.codename) {
        if (!assetsDbConfigured()) return res.status(200).json({ asset: null, notConfigured: true });
        const asset = await readAsset(str(q.codename, 40));
        if (!asset) return res.status(404).json({ error: "asset_not_found" });
        const runs = (await listRuns(asset.codename)) || [];
        const comparisons = (await listComparisons(asset.codename)) || [];
        return res.status(200).json({ asset, runs, comparisons });
      }
      if (!assetsDbConfigured()) return res.status(200).json({ assets: [], notConfigured: true });
      const assets = (await listAssets()) || [];
      return res.status(200).json({ assets: assets.map(summaryOf) });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    if (!assetsDbConfigured()) return res.status(503).json({ error: "not_configured" });

    const body = req.body || {};
    const action = str(body.action, 30);

    /* --------------------- save / delete --------------------- */
    if (action === "save-asset") {
      const existing = body.asset && body.asset.codename ? await readAsset(sanitizeCodename(body.asset.codename) || "") : null;
      const asset = sanitizeAsset(body.asset, byId, existing || undefined);
      if (!asset) return res.status(400).json({ error: "invalid_asset", message: "A codename and a track (medical / non-medical) are required." });
      if (existing && existing.frozen) {
        return res.status(409).json({ error: "frozen", message: `Asset ${asset.codename} is FROZEN (locked ${existing.frozen.at}). A frozen assessment cannot be edited — that is what makes the comparison order provable.` });
      }
      const validation = validateAsset(asset.track, asset.variables, asset.counts, asset.systems);
      asset.lastValidation = { at: new Date().toISOString(), errors: validation.errors, warnings: validation.warnings };
      await writeAsset(asset);
      return res.status(200).json({ asset, validation });
    }

    if (action === "delete-asset") {
      const codename = sanitizeCodename(body.codename);
      const existing = codename ? await readAsset(codename) : null;
      if (!existing) return res.status(404).json({ error: "asset_not_found" });
      if (existing.frozen) return res.status(409).json({ error: "frozen", message: "A frozen asset cannot be deleted." });
      await deleteAsset(codename);
      return res.status(200).json({ ok: true });
    }

    if (action === "freeze-asset") {
      const codename = sanitizeCodename(body.codename);
      const asset = codename ? await readAsset(codename) : null;
      if (!asset) return res.status(404).json({ error: "asset_not_found" });
      if (asset.frozen) return res.status(409).json({ error: "already_frozen", message: `Asset ${codename} was already frozen at ${asset.frozen.at}.` });
      const validation = validateAsset(asset.track, asset.variables, asset.counts, asset.systems);
      if (validation.errors.length) {
        return res.status(422).json({ error: "validation_failed", message: "Only an assessment that passes every check can be frozen.", errors: validation.errors });
      }
      asset.frozen = {
        at: new Date().toISOString(),
        snapshot: { variables: asset.variables, systems: asset.systems, counts: asset.counts }
      };
      asset.updatedAt = new Date().toISOString();
      await writeAsset(asset);
      return res.status(200).json({ asset });
    }

    /* --------------------- upload-and-run --------------------- */
    if (action === "start-run") {
      const codename = sanitizeCodename(body.codename);
      const asset = codename ? await readAsset(codename) : null;
      if (!asset) return res.status(404).json({ error: "asset_not_found", message: "Create the asset (codename + track) before uploading its documents." });
      if (asset.frozen) return res.status(409).json({ error: "frozen", message: "This asset's assessment is frozen; uploads are locked." });
      const files = Array.isArray(body.files) ? body.files.slice(0, 8) : [];
      if (!files.length) return res.status(400).json({ error: "no_files", message: "No files were uploaded." });

      /* Phase 1 PARSE + Phase 2 PHI SCREEN — before ANY storage. */
      const parsedDocs = [];
      const allFindings = [];
      for (const f of files) {
        const name = str(f && f.name, 120) || "file";
        const base64 = String((f && f.base64) || "");
        if (base64.length > 8_500_000) {
          return res.status(413).json({ error: "file_too_large", message: `"${name}" is larger than the 6 MB per-file limit for count documents.` });
        }
        const parsed = parseDocument({ name, base64 });
        const screen = phiScreen(parsed, name);
        allFindings.push({ file: name, findings: screen.findings, parseWarnings: parsed.warnings || [] });
        if (screen.blocked) {
          /* HARD GATE: nothing from this run is stored — no file,
             no tables, no run record. */
          return res.status(422).json({
            error: "phi_blocked", blocked: true,
            message: PHI_BLOCK_MESSAGE,
            findings: allFindings
          });
        }
        parsedDocs.push({ name, base64, parsed });
      }
      const candidates = extractCandidates(parsedDocs);
      if (!candidates.length) {
        return res.status(422).json({
          error: "nothing_extracted",
          message: "The documents parsed, but no count values were found to map. Aggregate reports with labeled counts (by year, type, language, category) work best — check the parse warnings.",
          findings: allFindings
        });
      }
      const proposals = proposeMapping(asset.track, candidates, asset.systems);

      /* Screen passed — NOW the source files may be stored. */
      const runId = newId("run");
      const storedFiles = [];
      for (const doc of parsedDocs) {
        let ref = null;
        if (filesConfigured()) {
          try { ref = await storeRunFile(asset.codename, runId, doc.name, doc.base64); } catch (e) { ref = null; }
        }
        storedFiles.push({
          name: doc.name,
          stored: !!ref, pathname: ref ? ref.pathname : null,
          tables: (doc.parsed.tables || []).map(t => ({ name: t.name, columns: t.columns, rows: t.rows.length })),
          kvCount: (doc.parsed.kv || []).length,
          parseWarnings: doc.parsed.warnings || []
        });
      }
      const run = {
        id: runId, codename: asset.codename, track: asset.track,
        at: new Date().toISOString(), status: "awaiting-mapping",
        files: storedFiles,
        screenFindings: allFindings.flatMap(f => f.findings.map(x => ({ ...x, file: f.file }))),
        candidates, proposals,
        systemProfiles: asset.systems.map(sel => {
          const cat = byId.get(sel.id);
          return cat ? { system: cat.name, confidence: cat.confidence, profile: cat.mappingProfile || [] } : null;
        }).filter(Boolean),
        mappingUsed: null, validation: null
      };
      await writeRun(run);
      return res.status(200).json({ run });
    }

    if (action === "confirm-run") {
      const run = await readRun(str(body.runId, 60));
      if (!run) return res.status(404).json({ error: "run_not_found" });
      if (run.status !== "awaiting-mapping") return res.status(409).json({ error: "run_already_confirmed", message: `Run ${run.id} is already ${run.status}.` });
      const asset = await readAsset(run.codename);
      if (!asset) return res.status(404).json({ error: "asset_not_found" });
      if (asset.frozen) return res.status(409).json({ error: "frozen", message: "This asset's assessment is frozen; the run cannot be applied." });
      const mapping = sanitizeMapping(body.mapping);
      const { counts, applied, notes, totalConflicts } = applyMapping(run.track, run.candidates, mapping);
      if (totalConflicts && totalConflicts.length) {
        /* A totals cell is the asset's denominator. Two differing
           values mapped to it must never be resolved silently —
           the stored total would differ from the figure the
           operator confirmed (live-walk defect, 2026-11-12).
           Nothing is written: the run stays awaiting-mapping and
           the operator un-maps one contender and re-confirms. */
        const detail = totalConflicts.map(tc =>
          `${tc.key}: ${tc.contenders.map(c => `"${c.label}" = ${c.value}`).join(" vs ")}`
        ).join("; ");
        return res.status(422).json({
          error: "total_conflict",
          message: `Two different values are mapped to the same asset total — a total is never chosen silently. Un-map one value for each conflicted total and confirm again. Conflicts: ${detail}.`,
          totalConflicts
        });
      }
      const validation = validateAsset(run.track, asset.variables, counts, asset.systems);
      run.mappingUsed = mapping;
      run.mappingNotes = notes;
      run.appliedCount = applied;
      run.validation = { errors: validation.errors, warnings: validation.warnings };
      run.status = validation.errors.length ? "validation-failed" : "assessed";
      run.confirmedAt = new Date().toISOString();
      await writeRun(run);
      asset.counts = counts;
      asset.countsSource = "run";
      asset.lastRunId = run.id;
      asset.manualEdits = [];
      asset.lastValidation = { at: run.confirmedAt, errors: validation.errors, warnings: validation.warnings };
      asset.updatedAt = run.confirmedAt;
      await writeAsset(asset);
      return res.status(200).json({ run, asset, validation });
    }

    /* --------------------- Stage 2: expert assessment --------------------- */
    if (action === "expert-assessment") {
      const codename = sanitizeCodename(body.codename);
      const asset = codename ? await readAsset(codename) : null;
      if (!asset) return res.status(404).json({ error: "asset_not_found" });
      const expert = analyzeExpertAssessment(asset, byId, { smallCellThreshold: sanitizeThreshold(body.smallCellThreshold) });
      return res.status(200).json({ expert });
    }

    if (action === "generate-expert-determination") {
      const codename = sanitizeCodename(body.codename);
      const asset = codename ? await readAsset(codename) : null;
      if (!asset) return res.status(404).json({ error: "asset_not_found" });
      if (asset.track !== "medical") return res.status(422).json({ error: "medical_only", message: "Expert determination drafts are available only on the medical track." });
      if (asset.frozen) return res.status(409).json({ error: "frozen", message: "This asset's assessment is frozen; a determination draft record cannot be added to it." });
      const draft = sanitizeExpertDraft(body.expert || body);
      if (!draft) return res.status(400).json({ error: "expert_required", message: "A named qualified expert, credentials and a valid review date are required. The system cannot generate a determination draft without them." });
      const expert = analyzeExpertAssessment(asset, byId, { smallCellThreshold: draft.smallCellThreshold });
      const document = buildExpertDeterminationDocument(asset, expert, draft);
      asset.expertDraft = draft;
      asset.updatedAt = new Date().toISOString();
      await writeAsset(asset);
      return res.status(200).json({ asset, expert, draft, determinationMarkdown: renderMarkdown(document) });
    }

    /* --------------------- assess (outputs) --------------------- */
    if (action === "assess") {
      const codename = sanitizeCodename(body.codename);
      const asset = codename ? await readAsset(codename) : null;
      if (!asset) return res.status(404).json({ error: "asset_not_found" });
      const { validation, outputs, markdown } = assessAsset(asset, byId);
      if (validation.errors.length) {
        return res.status(422).json({ error: "validation_failed", message: "Outputs are produced only from an assessment that passes every check.", errors: validation.errors, warnings: validation.warnings });
      }
      return res.status(200).json({ outputs, markdown, warnings: validation.warnings });
    }

    /* --------------------- catalog: add system --------------------- */
    if (action === "add-system") {
      const system = sanitizeCustomSystem(body.system);
      if (!system) return res.status(400).json({ error: "invalid_system", message: "A system needs at least a name." });
      await writeCustomSystem(system);
      const merged = await mergedCatalog();
      return res.status(200).json({ system: merged.byId.get(system.id), systems: merged.list });
    }

    /* --------------------- comparisons --------------------- */
    if (action === "add-comparison") {
      const codename = sanitizeCodename(body.codename);
      const asset = codename ? await readAsset(codename) : null;
      if (!asset) return res.status(404).json({ error: "asset_not_found" });
      const ext = sanitizeExternal(body.external);
      if (!ext) return res.status(400).json({ error: "invalid_external", message: "The external assessment needs at least its source label (e.g., DataSupply)." });
      const comparison = {
        id: newId("cmp"), codename,
        ...ext,
        enteredAt: new Date().toISOString(),
        fileRef: null, fileNote: "",
        divergenceNotes: {}
      };
      /* Optional upload of their document — same PHI screen; a
         blocked document is never stored, the entry still saves. */
      if (body.file && body.file.base64) {
        const name = str(body.file.name, 120) || ext.docName || "external-document";
        const parsed = parseDocument({ name, base64: String(body.file.base64) });
        const screen = phiScreen(parsed, name);
        if (screen.blocked) {
          comparison.fileNote = "The uploaded document was blocked by the PHI screen (row-level data or identifiers) and was NOT stored.";
        } else if (filesConfigured()) {
          try {
            const ref = await storeRunFile(codename, comparison.id, name, String(body.file.base64));
            comparison.fileRef = ref.pathname;
            comparison.docName = comparison.docName || name;
          } catch (e) { comparison.fileNote = "The document could not be stored; the entry was saved without it."; }
        } else {
          comparison.fileNote = "File storage is not configured; the entry was saved without the document.";
        }
      }
      await writeComparison(comparison);
      const view = compareAssessments(asset, comparison, {}, byId);
      return res.status(200).json({ comparison, view });
    }

    if (action === "update-comparison-notes") {
      const comparison = await readComparison(str(body.id, 60));
      if (!comparison) return res.status(404).json({ error: "comparison_not_found" });
      const notes = {};
      for (const [k, v] of Object.entries(body.notes || {})) {
        if (Object.keys(notes).length >= 24) break;
        notes[str(k, 40)] = str(v, 600);
      }
      comparison.divergenceNotes = { ...(comparison.divergenceNotes || {}), ...notes };
      await writeComparison(comparison);
      return res.status(200).json({ comparison });
    }

    if (action === "delete-comparison") {
      const comparison = await readComparison(str(body.id, 60));
      if (!comparison) return res.status(404).json({ error: "comparison_not_found" });
      await deleteComparison(comparison.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown_action" });
  } catch (e) {
    return res.status(503).json({ error: "store_failed", message: "The Data Asset Builder store did not answer. Nothing was saved." });
  }
}

export const _internals = { sanitizeAsset, sanitizeExternal, sanitizeCodename, validSession, sanitizeExpertDraft, sanitizeThreshold };
