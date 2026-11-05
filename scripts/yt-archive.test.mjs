/* Local test suite for api/yt-archive.js (IEC Office YT Archive).
   Runs the real handler against the in-memory Blob mock (the same
   scripts/testing/blob-hooks.mjs redirect the demo-admin and
   demo-activity suites use), with fetch mocked to serve the mock's
   blob URLs. No real Blob store, no network.

   Run: node scripts/yt-archive.test.mjs   (exit 1 on any failure)
   Staged note: until this file is applied into scripts/, it finds
   the hooks and the handler by candidate paths (sibling layout in
   the staging folder first, repo layout second). */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));

function pick(candidates, label) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`cannot locate ${label}; tried: ${candidates.join(", ")}`);
}

const hooksPath = pick([
  path.join(here, "testing", "blob-hooks.mjs"),
  path.join(os.homedir(), "workspace/repos/iecincglobal-site/scripts/testing/blob-hooks.mjs")
], "testing/blob-hooks.mjs");
register(pathToFileURL(hooksPath));

const handlerPath = pick([
  path.join(here, "api", "yt-archive.js"),
  path.join(here, "..", "api", "yt-archive.js")
], "api/yt-archive.js");

/* ---------------- env ---------------- */
const DESK_SECRET = "test-desk-secret";
const SYNC_SECRET = "test-yt-archive-sync-secret";
process.env.DESK_SESSION_SECRET = DESK_SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
delete process.env.YT_ARCHIVE_SYNC_SECRET;

/* ---------------- mocked fetch (serves the Blob mock only) -------- */
const blobMock = await import("@vercel/blob"); // redirected to the mock
blobMock.__reset();

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://blob.mock/")) {
    const pathname = decodeURIComponent(u.slice("https://blob.mock/".length));
    const rec = blobMock.__blobs.get(pathname);
    if (!rec) return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      text: async () => rec.content,
      json: async () => JSON.parse(rec.content)
    };
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- handler + call mocks ---------------- */
const mod = await import(pathToFileURL(handlerPath));
const handler = mod.default;
const X = mod._internals;

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", DESK_SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}

async function call({ method = "POST", action, body, cookie, secret } = {}) {
  const headers = {};
  if (cookie !== null) headers.cookie = cookie ?? sessionCookie();
  if (secret !== undefined && secret !== null) headers["x-yt-archive-secret"] = secret;
  const req = { method, headers, query: action ? { action } : {}, body };
  if (method === "GET") delete req.body;
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
const noAuth = { cookie: null };
const asRunner = { cookie: null, secret: SYNC_SECRET };

/* ---------------- tiny assert kit ---------------- */
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ok ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

/* ---------------- 1. URL + option validation (pure) ---------------- */
console.log("validation (pure)");
ok(!!X.plausibleYoutubeUrl("https://www.youtube.com/@morgan36mah"), "channel URL accepted");
ok(!!X.plausibleYoutubeUrl("https://www.youtube.com/watch?v=BaW_jenozKc"), "watch URL accepted");
ok(!!X.plausibleYoutubeUrl("https://youtube.com/playlist?list=PL123"), "bare youtube.com host accepted");
ok(!!X.plausibleYoutubeUrl("https://youtu.be/BaW_jenozKc"), "youtu.be short link accepted");
ok(!!X.plausibleYoutubeUrl("https://m.youtube.com/watch?v=x"), "m.youtube.com accepted");
ok(X.plausibleYoutubeUrl("https://vimeo.com/123") === null, "vimeo refused");
ok(X.plausibleYoutubeUrl("https://youtube.com.evil.example/@x") === null, "look-alike host refused");
ok(X.plausibleYoutubeUrl("not a url") === null, "garbage refused");
ok(X.plausibleYoutubeUrl("") === null, "empty refused");
ok(X.cleanQuality(undefined) === "best" && X.cleanQuality("720") === "720" && X.cleanQuality("4k") === null,
  "quality: default best, known values pass, unknown refused");
const pm = X.cleanProgress({ done: 3.9, bytes: "2048", current: "T".repeat(400), bogus: 1 });
ok(pm.done === 3 && pm.bytes === 2048 && pm.current.length === 300 && !("bogus" in pm) && !("total" in pm),
  "progress cleaning coerces, bounds, and drops unknown keys");
const mm = X.cleanManifest([{ upload_date: "20150414", title: "B", duration_sec: 61 }]);
ok(mm.length === 1 && mm[0].date === "20150414" && mm[0].duration === 61,
  "manifest cleaning normalizes upload_date / duration_sec");

/* ---------------- 2. secret fail-closed (env unset) ---------------- */
console.log("secret gating — unset");
let r = await call({ action: "claim", body: { id: "whatever" }, ...asRunner });
ok(r.status === 503 && r.body.error === "not_configured", "claim 503 when YT_ARCHIVE_SYNC_SECRET is unset");
r = await call({ method: "GET", action: "jobs", cookie: null, secret: "anything" });
ok(r.status === 503 && r.body.error === "not_configured", "jobs with a presented secret 503 when the env secret is unset");
r = await call({ method: "GET", action: "jobs", ...noAuth });
ok(r.status === 401, "jobs with neither session nor secret: 401");
process.env.YT_ARCHIVE_SYNC_SECRET = SYNC_SECRET;

/* ---------------- 3. session gating ---------------- */
console.log("session gating");
r = await call({ action: "queue", body: { url: "https://www.youtube.com/@morgan36mah" }, ...noAuth });
ok(r.status === 401 && r.body.error === "unauthorized", "queue 401 with no session cookie");
r = await call({ action: "queue", body: { url: "https://www.youtube.com/@morgan36mah" }, cookie: "desk_session=bogus.123.deadbeef" });
ok(r.status === 401, "queue 401 with a forged session cookie");
r = await call({ action: "queue", body: { url: "https://vimeo.com/123" }, ...noAuth });
ok(r.status === 401, "auth precedes validation (bad URL + no session = 401, not 400)");
r = await call({ action: "cancel", body: { id: "x" }, cookie: null, secret: SYNC_SECRET });
ok(r.status === 401, "cancel is Desk-only: the sync secret does not open it");

/* ---------------- 4. queue ---------------- */
console.log("queue");
r = await call({ action: "queue", body: { url: "https://vimeo.com/123" } });
ok(r.status === 400 && r.body.error === "invalid_url", "queue refuses a non-YouTube URL");
r = await call({ action: "queue", body: { url: "https://www.youtube.com/@morgan36mah", quality: "4k" } });
ok(r.status === 400 && r.body.error === "invalid_quality", "queue refuses an unknown quality");
r = await call({ action: "queue", body: { url: "https://www.youtube.com/@morgan36mah", quality: "720", subtitles: true } });
ok(r.status === 200 && r.body.ok === true, "queue answers 200");
const job1 = r.body.job;
ok(job1 && /^[0-9a-f-]{36}$/.test(job1.id), "job carries a uuid id");
ok(job1.status === "queued" && job1.url === "https://www.youtube.com/@morgan36mah", "job queued with the normalized URL");
ok(job1.options.quality === "720" && job1.options.subtitles === true && job1.options.audioOnly === false,
  "job options recorded (quality, subtitles, audioOnly)");
ok(job1.progress.done === 0 && job1.progress.total === null && job1.progress.bytes === 0 && job1.progress.current === "",
  "job progress starts empty");
ok(Array.isArray(job1.manifest) && job1.manifest.length === 0 && job1.totals === null && job1.error === null,
  "job manifest/totals/error start empty");
ok(/T\d{2}:\d{2}:\d{2}-0[45]:00$/.test(job1.createdAt), "createdAt is Eastern ISO");
ok(blobMock.__blobs.has("yt-archive/jobs.json"), "jobs document exists in the Blob store");

r = await call({ action: "queue", body: { url: "https://youtu.be/BaW_jenozKc" } });
ok(r.status === 200 && r.body.job.options.quality === "best", "second job queued, quality defaults to best");
const job2 = r.body.job;

/* ---------------- 5. jobs read (either gate) ---------------- */
console.log("jobs");
r = await call({ method: "GET", action: "jobs" });
ok(r.status === 200 && r.body.jobs.length === 2, "jobs via session lists both jobs");
ok(r.body.jobs[0].id === job2.id && r.body.jobs[1].id === job1.id, "jobs are newest-first");
r = await call({ method: "GET", action: "jobs", ...asRunner });
ok(r.status === 200 && r.body.jobs.length === 2, "jobs via sync secret lists both jobs");
r = await call({ method: "GET", action: "jobs", cookie: null, secret: "wrong-secret" });
ok(r.status === 401, "jobs with a wrong secret and no session: 401");
const jobsJson = JSON.stringify(r.body) + JSON.stringify((await call({ method: "GET", action: "jobs" })).body);
ok(!jobsJson.includes(SYNC_SECRET) && !jobsJson.includes(DESK_SECRET), "no secret value appears in any jobs output");

/* ---------------- 6. claim (queued only) ---------------- */
console.log("claim");
r = await call({ action: "claim", body: { id: job1.id }, cookie: null });
ok(r.status === 401, "claim 401 with no secret header");
r = await call({ action: "claim", body: { id: job1.id }, cookie: null, secret: "nope" });
ok(r.status === 401, "claim 401 with a wrong secret");
r = await call({ action: "claim", body: { id: job1.id } });
ok(r.status === 401, "claim is runner-only: a Desk session does not open it");
r = await call({ action: "claim", body: { id: job1.id }, ...asRunner });
ok(r.status === 200 && r.body.ok === true && r.body.job.status === "running" && !!r.body.job.claimedAt,
  "claim moves a queued job to running and stamps claimedAt");
r = await call({ action: "claim", body: { id: job1.id }, ...asRunner });
ok(r.status === 200 && r.body.ok === false && r.body.error === "not_queued", "claim on a running job: not_queued");
r = await call({ action: "claim", body: { id: "no-such-id" }, ...asRunner });
ok(r.status === 404 && r.body.error === "not_found", "claim on an unknown id: 404");

/* ---------------- 7. progress merge ---------------- */
console.log("progress");
r = await call({ action: "progress", body: { id: job1.id, progress: { done: 3, bytes: 12345 } }, ...asRunner });
ok(r.status === 200 && r.body.job.progress.done === 3 && r.body.job.progress.bytes === 12345 &&
   r.body.job.progress.total === null && r.body.job.progress.current === "",
  "progress merges the reported fields, keeps the rest");
r = await call({ action: "progress", body: { id: job1.id, progress: { current: "Some Title", total: 10 } }, ...asRunner });
ok(r.body.job.progress.done === 3 && r.body.job.progress.current === "Some Title" && r.body.job.progress.total === 10,
  "a second progress report merges without wiping the first");
r = await call({ action: "progress", body: { id: job1.id, progress: { done: 4 } } });
ok(r.status === 401, "progress is runner-only: a Desk session does not open it");

/* ---------------- 8. complete stores the manifest ---------------- */
console.log("complete");
const manifestIn = [
  { date: "2015-04-13", title: "First Video", duration: 95 },
  { upload_date: "20150414", title: "Second Video", duration_sec: 61 }
];
r = await call({ action: "complete", body: { id: job1.id, manifest: manifestIn, totals: { files: 2, bytes: 999 } }, ...asRunner });
ok(r.status === 200 && r.body.job.status === "done" && !!r.body.job.completedAt, "complete moves the job to done");
ok(r.body.job.manifest.length === 2 && r.body.job.manifest[0].title === "First Video" &&
   r.body.job.manifest[1].date === "20150414" && r.body.job.manifest[1].duration === 61,
  "manifest stored, runner spellings normalized");
ok(r.body.job.totals && r.body.job.totals.files === 2 && r.body.job.totals.bytes === 999, "totals stored");
r = await call({ method: "GET", action: "jobs" });
const stored1 = r.body.jobs.find(j => j.id === job1.id);
ok(stored1 && stored1.status === "done" && stored1.manifest.length === 2, "the stored manifest round-trips through jobs");
const storedDoc = JSON.parse(blobMock.__blobs.get("yt-archive/jobs.json").content);
ok(Array.isArray(storedDoc) && storedDoc.some(j => j.id === job1.id && j.status === "done"),
  "the Blob document itself holds the completed job");
r = await call({ action: "complete", body: { id: job1.id, manifest: [], totals: null }, ...asRunner });
ok(r.status === 200 && r.body.ok === false && r.body.error === "job_finished", "complete on a done job: job_finished");
r = await call({ action: "progress", body: { id: job1.id, progress: { done: 9 } }, ...asRunner });
ok(r.body.ok === false && r.body.error === "job_finished", "progress on a done job: job_finished");
r = await call({ action: "complete", body: { id: job2.id, manifest: "not-an-array" }, ...asRunner });
ok(r.status === 400 && r.body.error === "invalid_manifest", "complete refuses a non-array manifest");

/* ---------------- 9. fail ---------------- */
console.log("fail");
r = await call({ action: "claim", body: { id: job2.id }, ...asRunner });
ok(r.body.ok === true && r.body.job.status === "running", "second job claimed");
r = await call({ action: "fail", body: { id: job2.id, error: "HTTP 429 from YouTube" }, ...asRunner });
ok(r.status === 200 && r.body.job.status === "failed" && r.body.job.error === "HTTP 429 from YouTube",
  "fail stores the runner's error");

/* ---------------- 10. cancel (queued only, Desk only) ---------------- */
console.log("cancel");
r = await call({ action: "queue", body: { url: "https://www.youtube.com/playlist?list=PL123" } });
const job3 = r.body.job;
ok(r.status === 200 && job3.status === "queued", "third job queued");
r = await call({ action: "cancel", body: { id: job3.id } });
ok(r.status === 200 && r.body.ok === true && r.body.job.status === "cancelled", "cancel moves a queued job to cancelled");
r = await call({ action: "cancel", body: { id: job3.id } });
ok(r.status === 200 && r.body.ok === false && r.body.error === "not_queued", "cancel on a cancelled job: not_queued");
r = await call({ action: "queue", body: { url: "https://youtu.be/abc123XYZ" } });
const job4 = r.body.job;
r = await call({ action: "claim", body: { id: job4.id }, ...asRunner });
ok(r.body.ok === true, "fourth job claimed");
r = await call({ action: "cancel", body: { id: job4.id } });
ok(r.body.ok === false && r.body.error === "not_queued" && r.body.status === "running",
  "cancel on a running job is refused (only queued jobs cancel)");

/* ---------------- 11. store fail-closed ---------------- */
console.log("fail-closed — store");
delete process.env.BLOB_READ_WRITE_TOKEN;
r = await call({ action: "queue", body: { url: "https://www.youtube.com/@morgan36mah" } });
ok(r.status === 503 && r.body.error === "not_configured", "queue 503 when the Blob token is unset");
r = await call({ action: "claim", body: { id: job4.id }, ...asRunner });
ok(r.status === 503 && r.body.error === "not_configured", "claim 503 when the Blob token is unset");
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
r = await call({ method: "GET", action: "jobs" });
ok(r.status === 200 && r.body.jobs.length === 4, "jobs recovers once env is restored (4 jobs on record)");

/* ---------------- 12. routing ---------------- */
console.log("routing");
r = await call({ action: "bogus", body: {} });
ok(r.status === 400 && r.body.error === "unknown_action", "unknown action refused");
r = await call({ method: "GET", action: "queue" });
ok(r.status === 405 && r.body.error === "method_not_allowed", "queue over GET: 405");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
