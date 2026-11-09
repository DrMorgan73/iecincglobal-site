/* Local test suite for api/office-layout.js (IEC Office — "My Office"
   Organizer layout). Runs the real handler against the in-memory
   Blob mock: session gate (401), default layout, save + read-back,
   sanitizing (unknown ids dropped, missing modules appended,
   organizer can never be hidden), reset, and the unconfigured-store
   answers. No real Blob writes.

   Run: node scripts/office-layout.test.mjs   (exit 1 on any failure) */

import crypto from "node:crypto";
import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);
const blobMock = await import("./testing/blob-mock.mjs");

const SECRET = "test-desk-secret";
process.env.DESK_SESSION_SECRET = SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";

const textRes = (status, text) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new Error("not json"); },
  text: async () => text
});

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith("https://blob.mock/")) {
    for (const rec of blobMock.__blobs.values()) {
      if (rec.url === u) return textRes(200, rec.content);
    }
    return textRes(404, "");
  }
  throw new Error(`unmocked fetch: ${u}`);
};

const mod = await import("../api/office-layout.js");
const handler = mod.default;
const X = mod._internals;

function sessionCookie(user = "drmorgan", exp = Math.floor(Date.now() / 1000) + 3600) {
  const sig = crypto.createHmac("sha256", SECRET).update(`${user}.${exp}`).digest("hex");
  return `desk_session=${user}.${exp}.${sig}`;
}

async function call(method, body, cookie) {
  const req = {
    method,
    headers: cookie === null ? {} : { cookie: cookie ?? sessionCookie() },
    body
  };
  const res = {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader() {},
    end(s) { this.payload = JSON.parse(s); }
  };
  await handler(req, res);
  return res;
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok — ${name}`);
  else { failures++; console.error(`  FAIL — ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`); }
}

console.log("office-layout.test");

/* --- session gate --- */
let r = await call("GET", undefined, null);
check("no cookie → 401", r.statusCode === 401 && r.payload.error === "unauthorized", r);
r = await call("GET", undefined, "desk_session=forged.9999999999.deadbeef");
check("forged cookie → 401", r.statusCode === 401, r);
r = await call("POST", { order: [], hidden: [] }, null);
check("POST without session → 401", r.statusCode === 401, r);

/* --- default: nothing saved --- */
r = await call("GET");
check("fresh GET → ok, layout null", r.statusCode === 200 && r.payload.ok === true && r.payload.layout === null, r);

/* --- save + read back --- */
const order = ["vault", "docs", "opps", "home"];
r = await call("POST", { order, hidden: ["trade", "growth"] });
check("POST save → 200 ok", r.statusCode === 200 && r.payload.ok === true, r);
check("saved order starts with his picks", JSON.stringify(r.payload.layout.order.slice(0, 4)) === JSON.stringify(order), r.payload.layout);
check("all modules present in stored order", r.payload.layout.order.length === X.MODULE_IDS.length, r.payload.layout.order);
check("missing modules appended in default order", r.payload.layout.order[4] === "suzy-chat", r.payload.layout.order);
check("hidden stored", JSON.stringify(r.payload.layout.hidden) === JSON.stringify(["trade", "growth"]), r.payload.layout);
check("updatedAt stamped", typeof r.payload.layout.updatedAt === "string" && r.payload.layout.updatedAt.length > 0, r.payload.layout);

r = await call("GET");
check("GET returns the saved layout", r.statusCode === 200 && r.payload.layout && r.payload.layout.order[0] === "vault" && r.payload.layout.hidden.includes("trade"), r.payload);

/* --- sanitizing --- */
r = await call("POST", { order: ["bogus", "home", "home", 42, null], hidden: ["organizer", "vault", "nope"] });
check("unknown ids + duplicates dropped", !r.payload.layout.order.includes("bogus") && r.payload.layout.order.filter(x => x === "home").length === 1, r.payload.layout);
check("organizer can never be hidden", !r.payload.layout.hidden.includes("organizer") && r.payload.layout.hidden.includes("vault"), r.payload.layout);

/* --- reset --- */
r = await call("POST", { action: "reset" });
check("reset → layout null", r.statusCode === 200 && r.payload.ok === true && r.payload.layout === null, r);
r = await call("GET");
check("GET after reset → layout null", r.statusCode === 200 && r.payload.layout === null, r.payload);

/* --- method guard --- */
r = await call("DELETE", undefined);
check("DELETE → 405", r.statusCode === 405, r);

/* --- unconfigured store --- */
delete process.env.BLOB_READ_WRITE_TOKEN;
r = await call("GET");
check("GET unconfigured → ok, layout null", r.statusCode === 200 && r.payload.ok === true && r.payload.layout === null && r.payload.configured === false, r);
r = await call("POST", { order: ["home"], hidden: [] });
check("POST unconfigured → 503 not_configured", r.statusCode === 503 && r.payload.error === "not_configured", r);
process.env.BLOB_READ_WRITE_TOKEN = "blob-test-token";

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll office-layout tests passed.");
