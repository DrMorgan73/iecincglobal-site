/* Local test suite for api/questionnaire-submit.js +
   api/_questionnaire-db.js + api/_questionnaire-store.js.

   @vercel/blob is redirected to an in-memory mock (scripts/testing/)
   via module hooks; fetch is mocked for Resend, the Blob URLs and
   the Neon HTTPS SQL endpoint (host derived from the test
   connection URI). No real database, no real Blob store, no real
   emails.

   Run: node scripts/questionnaire-submit.test.mjs   (exit 1 on failure) */

import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);

const blobMock = await import("./testing/blob-mock.mjs");
const { __blobs } = blobMock;

/* ---------------- env ---------------- */
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
process.env.QUESTIONNAIRE_DATABASE_URL = "postgres://user:pass@neon-sql.test:5432/iec_questionnaires?sslmode=require";
process.env.DEMO_ADMIN_RESEND_API_KEY = "test-resend-key";
delete process.env.QDB_MIGRATE_TOKEN;

/* ---------------- mocked Neon SQL endpoint ---------------- */
/* In-memory stand-in for questionnaire_submissions, keyed by
   reference. `neonMode` steers failure injection:
     "ok"        — behave
     "throw"     — transport failure (fetch rejects)
     "sql-error" — Postgres error object in the response body */
const dbRows = new Map();
let neonMode = "ok";
const sentEmails = [];

function neonSql(query, params) {
  if (/^INSERT INTO/.test(query)) {
    const [reference, segment, contact, answers, website, submittedAt, raw] = params;
    const ignoreConflict = /ON CONFLICT/.test(query);
    if (dbRows.has(reference)) {
      if (ignoreConflict) return { rows: [], rowCount: 0 };
      return { severity: "ERROR", code: "23505", message: "duplicate key value violates unique constraint" };
    }
    dbRows.set(reference, {
      reference, segment,
      contact: JSON.parse(contact), answers: JSON.parse(answers),
      company_website: website, submitted_at: submittedAt,
      raw_payload: raw ? JSON.parse(raw) : null
    });
    return { rows: [{ reference }], rowCount: 1 };
  }
  if (/^SELECT segment, submitted_at/.test(query)) {
    const row = dbRows.get(params[0]);
    return { rows: row ? [{ segment: row.segment, submitted_at: row.submitted_at }] : [], rowCount: row ? 1 : 0 };
  }
  if (/^SELECT count/.test(query)) {
    return { rows: [{ n: dbRows.size }], rowCount: 1 };
  }
  throw new Error(`unmocked SQL: ${query.slice(0, 60)}`);
}

const jsonRes = (status, obj) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
  text: async () => JSON.stringify(obj)
});
const textRes = (status, text) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new Error("not json"); },
  text: async () => text
});

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === "https://neon-sql.test/sql") {
    if (neonMode === "throw") throw new Error("network down");
    const { query, params } = JSON.parse(opts.body);
    if (neonMode === "sql-error") return jsonRes(200, { severity: "ERROR", code: "XX000", message: "boom" });
    return jsonRes(200, neonSql(query, params));
  }
  if (u === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(opts.body));
    return jsonRes(200, { id: `email-${sentEmails.length}` });
  }
  if (u.startsWith("https://blob.mock/")) {
    for (const rec of __blobs.values()) {
      if (rec.url === u) return textRes(200, rec.content);
    }
    return textRes(404, "");
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- handler + mocks ---------------- */
const handler = (await import("../api/questionnaire-submit.js")).default;
const store = await import("../api/_questionnaire-store.js");

async function call(method, { url = "/api/questionnaire-submit", body } = {}) {
  const req = { method, url, headers: {}, body };
  const res = {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader() {},
    end(s) { this.payload = JSON.parse(s); }
  };
  await handler(req, res);
  return { status: res.statusCode, body: res.payload };
}

function resetAll() {
  __blobs.clear();
  dbRows.clear();
  sentEmails.length = 0;
  neonMode = "ok";
}

/* ---------------- tiny assert kit ---------------- */
let pass = 0, fail = 0;
function ok2(cond, label) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

const SUBMISSION = {
  segment: "general-business",
  contact: { name: "Test Owner", business: "Test Biz LLC", email: "owner@example.com", phone: "555-0100" },
  answers: { "Total employees (full-time / part-time)": "12 / 3" },
  company_website: ""
};

/* 1 — happy path: DB primary lands, Blob backup lands, email sent */
resetAll();
{
  const r = await call("POST", { body: SUBMISSION });
  ok2(r.status === 200 && r.body.ok === true, "happy path answers 200 ok");
  ok2(r.body.stored === true && r.body.emailed === true, "happy path reports stored + emailed");
  ok2(dbRows.size === 1, "row inserted into the database");
  const row = dbRows.get(r.body.id);
  ok2(!!row && row.segment === "general-business", "row carries the reference + segment");
  ok2(row && row.contact.email === "owner@example.com", "row contact matches");
  ok2(row && row.answers["Total employees (full-time / part-time)"] === "12 / 3", "row answers match");
  ok2(row && row.raw_payload && row.raw_payload.contact.name === "Test Owner", "raw_payload holds the received body");
  const blob = await store.readSubmissions();
  ok2(blob.length === 1 && blob[0].id === r.body.id, "Blob backup holds the same submission");
  ok2(sentEmails.length === 1, "notification email sent once");

  const check = await call("GET", { url: `/api/questionnaire-submit?id=${r.body.id}` });
  ok2(check.status === 200 && check.body.found === true && check.body.segment === "general-business",
    "GET existence check finds the submission in the database");
  const missing = await call("GET", { url: "/api/questionnaire-submit?id=zzzzzzzz-4040" });
  ok2(missing.status === 200 && missing.body.found === false, "GET existence check reports a miss");
}

/* 2 — DB transport failure: error response, backup + email still land */
resetAll();
neonMode = "throw";
{
  const r = await call("POST", { body: SUBMISSION });
  ok2(r.status === 502 && r.body.error === "store_failed", "DB failure surfaces as 502 store_failed");
  ok2(dbRows.size === 0, "no row in the database");
  const blob = await store.readSubmissions();
  ok2(blob.length === 1, "Blob backup still captured the submission");
  ok2(sentEmails.length === 1, "notification email still sent");
}

/* 3 — DB SQL error object: same surfacing */
resetAll();
neonMode = "sql-error";
{
  const r = await call("POST", { body: SUBMISSION });
  ok2(r.status === 502 && r.body.error === "store_failed", "DB SQL error surfaces as 502 store_failed");
}

/* 4 — Blob not configured: DB alone carries the submission */
resetAll();
delete process.env.BLOB_READ_WRITE_TOKEN;
{
  const r = await call("POST", { body: SUBMISSION });
  ok2(r.status === 200 && r.body.stored === true, "DB-only path answers 200 stored");
  ok2(dbRows.size === 1, "row inserted with no Blob configured");
}
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";

/* 5 — honeypot: rejected before any store is touched */
resetAll();
{
  const r = await call("POST", { body: { ...SUBMISSION, company_website: "http://spam.example" } });
  ok2(r.status === 400 && r.body.error === "rejected", "filled honeypot rejected 400");
  ok2(dbRows.size === 0 && sentEmails.length === 0, "honeypot rejection stores + sends nothing");
}

/* 6 — one-time migration: Blob records move to the DB, idempotently */
resetAll();
process.env.QDB_MIGRATE_TOKEN = "migrate-secret";
{
  await store.appendSubmission({
    id: "mig00001-aaaa", receivedAt: "2026-11-06T15:00:00.000Z", segment: "pharmacy",
    contact: { name: "A", business: "B", email: "a@example.com", phone: "" },
    answers: { Q: "1" }
  });
  await store.appendSubmission({
    id: "mig00002-bbbb", receivedAt: "2026-11-07T15:00:00.000Z", segment: "pt",
    contact: { name: "C", business: "D", email: "c@example.com", phone: "" },
    answers: {}
  });
  const denied = await call("GET", { url: "/api/questionnaire-submit?migrate=1&token=wrong" });
  ok2(denied.status === 404, "migration refuses a wrong token");
  const r = await call("GET", { url: "/api/questionnaire-submit?migrate=1&token=migrate-secret" });
  ok2(r.status === 200 && r.body.blobCount === 2 && r.body.inserted === 2 && r.body.dbTotal === 2,
    "migration moves both Blob records into the database");
  const row = dbRows.get("mig00001-aaaa");
  ok2(!!row && row.submitted_at === "2026-11-06T15:00:00.000Z", "migration preserves the original timestamp");
  const again = await call("GET", { url: "/api/questionnaire-submit?migrate=1&token=migrate-secret" });
  ok2(again.status === 200 && again.body.inserted === 0 && again.body.dbTotal === 2,
    "migration is idempotent on re-run");
}
delete process.env.QDB_MIGRATE_TOKEN;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
