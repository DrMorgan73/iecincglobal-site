/* =====================================================================
   IEC Suite — Data Asset Builder: STORAGE
   ---------------------------------------------------------------------
   Saved assets, run records, external comparisons and operator-added
   catalog systems live in NEON POSTGRES (the questionnaire pipeline's
   database — api/_questionnaire-db.js set the pattern: HTTPS SQL
   endpoint, no driver dependency) because these packages must
   survive across sessions and machines. Tables:

     data_assets            one row per asset (codename PK, doc jsonb)
     data_asset_runs        one row per pipeline run (id PK, doc jsonb)
     data_asset_comparisons one row per external assessment (id PK)
     data_assets_catalog    operator-added systems (id PK, doc jsonb)

   Tables are created with CREATE TABLE IF NOT EXISTS on first use —
   an idempotent bootstrap, so no manual migration is needed.

   Uploaded SOURCE FILES are bytes, not records: they go to the
   Office Blob store (the Dana pattern) under
   data-assets/<codename>/<runId>/<filename> — and ONLY after the
   PHI screen has passed them. A blocked file is never written here;
   the API enforces that order.

   The database URL is read from DATA_ASSETS_DATABASE_URL when set,
   falling back to QUESTIONNAIRE_DATABASE_URL (the same Neon database
   the questionnaire pipeline already uses on this project).
   ===================================================================== */

import { put, list } from "@vercel/blob";

const globalKey = "__iecDataAssetsStore";
const state = globalThis[globalKey] || (globalThis[globalKey] = { urlOverride: undefined, tablesReady: false });

function databaseUrl() {
  if (state.urlOverride !== undefined) return state.urlOverride;
  return process.env.DATA_ASSETS_DATABASE_URL || process.env.QUESTIONNAIRE_DATABASE_URL || "";
}

export function assetsDbConfigured() {
  return !!databaseUrl();
}

function parseDatabaseUrl(raw) {
  const url = new URL(raw);
  const host = url.hostname;
  const auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  return { host, auth, database: url.pathname.replace(/^\//, "") || "neondb" };
}

async function neonQuery(text, params) {
  const { host, auth, database } = parseDatabaseUrl(databaseUrl());
  const res = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": `postgres://${auth}@${host}/${database}?sslmode=require`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: text, params: params || [] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`neon ${res.status}: ${data && data.message ? String(data.message).slice(0, 200) : "query failed"}`);
  }
  if (data && data.error) throw new Error(String(data.error).slice(0, 200));
  return (data && data.rows) || [];
}

async function ensureTables() {
  if (state.tablesReady) return;
  await neonQuery(`CREATE TABLE IF NOT EXISTS data_assets (
    codename text PRIMARY KEY, track text NOT NULL, asset jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS data_asset_runs (
    id text PRIMARY KEY, codename text NOT NULL, run jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS data_asset_comparisons (
    id text PRIMARY KEY, codename text NOT NULL, comparison jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`);
  await neonQuery(`CREATE TABLE IF NOT EXISTS data_assets_catalog (
    id text PRIMARY KEY, system jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
  state.tablesReady = true;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export async function listAssets() {
  if (!assetsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT asset FROM data_assets ORDER BY updated_at DESC LIMIT 200`);
  return rows.map(r => r.asset).filter(Boolean);
}

export async function readAsset(codename) {
  if (!assetsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT asset FROM data_assets WHERE codename = $1`, [codename]);
  return rows.length ? rows[0].asset : null;
}

export async function writeAsset(asset) {
  if (!assetsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO data_assets (codename, track, asset, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (codename) DO UPDATE SET track = EXCLUDED.track, asset = EXCLUDED.asset, updated_at = now()`,
    [asset.codename, asset.track, JSON.stringify(asset)]
  );
  return true;
}

export async function deleteAsset(codename) {
  if (!assetsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(`DELETE FROM data_assets WHERE codename = $1`, [codename]);
  await neonQuery(`DELETE FROM data_asset_runs WHERE codename = $1`, [codename]);
  await neonQuery(`DELETE FROM data_asset_comparisons WHERE codename = $1`, [codename]);
  return true;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export async function writeRun(run) {
  if (!assetsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO data_asset_runs (id, codename, run) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET run = EXCLUDED.run`,
    [run.id, run.codename, JSON.stringify(run)]
  );
  return true;
}

export async function readRun(id) {
  if (!assetsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT run FROM data_asset_runs WHERE id = $1`, [id]);
  return rows.length ? rows[0].run : null;
}

export async function listRuns(codename) {
  if (!assetsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT run FROM data_asset_runs WHERE codename = $1 ORDER BY created_at DESC LIMIT 50`, [codename]);
  return rows.map(r => r.run).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* External comparisons (internal only — never exported)               */
/* ------------------------------------------------------------------ */

export async function writeComparison(comparison) {
  if (!assetsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO data_asset_comparisons (id, codename, comparison) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET comparison = EXCLUDED.comparison`,
    [comparison.id, comparison.codename, JSON.stringify(comparison)]
  );
  return true;
}

export async function readComparison(id) {
  if (!assetsDbConfigured()) return undefined;
  await ensureTables();
  const rows = await neonQuery(`SELECT comparison FROM data_asset_comparisons WHERE id = $1`, [id]);
  return rows.length ? rows[0].comparison : null;
}

export async function listComparisons(codename) {
  if (!assetsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT comparison FROM data_asset_comparisons WHERE codename = $1 ORDER BY created_at DESC LIMIT 50`, [codename]);
  return rows.map(r => r.comparison).filter(Boolean);
}

export async function deleteComparison(id) {
  if (!assetsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(`DELETE FROM data_asset_comparisons WHERE id = $1`, [id]);
  return true;
}

/* ------------------------------------------------------------------ */
/* Operator-added catalog systems                                      */
/* ------------------------------------------------------------------ */

export async function listCustomSystems() {
  if (!assetsDbConfigured()) return null;
  await ensureTables();
  const rows = await neonQuery(`SELECT system FROM data_assets_catalog ORDER BY created_at ASC LIMIT 200`);
  return rows.map(r => r.system).filter(Boolean);
}

export async function writeCustomSystem(system) {
  if (!assetsDbConfigured()) return false;
  await ensureTables();
  await neonQuery(
    `INSERT INTO data_assets_catalog (id, system) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET system = EXCLUDED.system`,
    [system.id, JSON.stringify(system)]
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Source files (Blob) — call ONLY for files that passed the screen.   */
/* ------------------------------------------------------------------ */

export function filesConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

const safeName = name => String(name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);

export async function storeRunFile(codename, runId, fileName, base64) {
  const pathname = `data-assets/${safeName(codename)}/${safeName(runId)}/${safeName(fileName)}`;
  const blob = await put(pathname, Buffer.from(String(base64 || ""), "base64"), {
    access: "private", addRandomSuffix: false, allowOverwrite: true
  });
  return { pathname: blob.pathname, url: blob.url };
}

export async function listRunFiles(codename) {
  const { blobs } = await list({ prefix: `data-assets/${safeName(codename)}/`, limit: 200 });
  return blobs.map(b => ({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt }));
}

/* Test-only: point the store at a fake database / reset bootstrap. */
export const _internals = {
  setUrlForTests(url) { state.urlOverride = url; state.tablesReady = false; },
  parseDatabaseUrl, neonQuery, ensureTables, safeName
};
