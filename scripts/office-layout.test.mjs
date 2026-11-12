/* Local test suite for api/office-layout.js (IEC Office — "Your
   office" layout) and the consolidated Office surface (2026-11-09:
   the Organizer page was retired into the "Your office" grid on
   desk/office.html). Runs the real handler against the in-memory
   Blob mock: session gate (401), default layout, save + read-back,
   sanitizing (unknown ids dropped, missing modules inserted at
   their registry position, the retired "organizer" id dropped
   everywhere), stale saved-layout compatibility, the stale-layout
   self-heal (a layout saved before Dana — Follow-Up existed gains
   it next to Dana — Opportunities on read), reset, the
   unconfigured-store answers — plus static checks that office.html
   carries the controls, that organizer.html redirects to it, and
   that the desk.js registry no longer lists a separate My Office
   module. No real Blob writes.

   Run: node scripts/office-layout.test.mjs   (exit 1 on any failure) */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
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
check("saved order starts with his picks (missing modules slot in after them by registry position, picks keep relative order — see checks below)",
  JSON.stringify(r.payload.layout.order.slice(0, 3)) === JSON.stringify(order.slice(0, 3)) &&
  r.payload.layout.order.indexOf("home") > r.payload.layout.order.indexOf("opps"), r.payload.layout);
check("all modules present in stored order", r.payload.layout.order.length === X.MODULE_IDS.length, r.payload.layout.order);
check("missing modules inserted at registry position — Dana — Follow-Up lands right after Dana — Opportunities",
  r.payload.layout.order.indexOf("dana-followup") === r.payload.layout.order.indexOf("opps") + 1, r.payload.layout.order);
check("missing modules inserted at registry position — Data Asset Builder follows Dana — Follow-Up",
  r.payload.layout.order.indexOf("data-builder") === r.payload.layout.order.indexOf("dana-followup") + 1, r.payload.layout.order);
check("missing modules inserted at registry position — Deals follows Questionnaire Submissions",
  r.payload.layout.order.indexOf("deals") === r.payload.layout.order.indexOf("questionnaire-submissions") + 1, r.payload.layout.order);
check("missing modules inserted at registry position — Suzy Chat right after Home, Demo Users after Suzy",
  r.payload.layout.order.indexOf("suzy-chat") === r.payload.layout.order.indexOf("home") + 1 &&
  r.payload.layout.order.indexOf("demo-users") === r.payload.layout.order.indexOf("suzy-chat") + 1, r.payload.layout.order);
check("his explicit picks keep their relative order",
  ["vault", "docs", "opps", "home"].every((id, i, a) => i === 0 || r.payload.layout.order.indexOf(a[i - 1]) < r.payload.layout.order.indexOf(id)), r.payload.layout.order);
check("hidden stored", JSON.stringify(r.payload.layout.hidden) === JSON.stringify(["trade", "growth"]), r.payload.layout);
check("updatedAt stamped", typeof r.payload.layout.updatedAt === "string" && r.payload.layout.updatedAt.length > 0, r.payload.layout);

r = await call("GET");
check("GET returns the saved layout", r.statusCode === 200 && r.payload.layout && r.payload.layout.order[0] === "vault" && r.payload.layout.hidden.includes("trade"), r.payload);

/* --- sanitizing --- */
r = await call("POST", { order: ["bogus", "home", "home", 42, null], hidden: ["organizer", "vault", "nope"] });
check("unknown ids + duplicates dropped", !r.payload.layout.order.includes("bogus") && r.payload.layout.order.filter(x => x === "home").length === 1, r.payload.layout);
check("retired 'organizer' id dropped everywhere", !r.payload.layout.order.includes("organizer") && !r.payload.layout.hidden.includes("organizer") && r.payload.layout.hidden.includes("vault"), r.payload.layout);
check("registry holds exactly 21 modules, organizer retired", X.MODULE_IDS.length === 21 && !X.MODULE_IDS.includes("organizer"), X.MODULE_IDS);

/* --- saved-layout compatibility: a pre-consolidation document ---
   A layout saved while the Organizer still existed names the
   "organizer" id in both lists. Seeded straight into the store
   (the API itself would never write it) — the GET must serve it
   back cleaned, with his real picks intact, never an error. */
blobMock.__blobs.set("office-layout.json", {
  content: JSON.stringify({ order: ["organizer", "vault", "home"], hidden: ["organizer", "trade"], updatedAt: "2026-11-09T00:00:00.000Z" }),
  url: "https://blob.mock/office-layout.json",
  uploadedAt: new Date()
});
r = await call("GET");
check("stale layout loads, retired id gone", r.statusCode === 200 && r.payload.layout && !r.payload.layout.order.includes("organizer") && !r.payload.layout.hidden.includes("organizer"), r.payload);
check("stale layout keeps his real picks", r.payload.layout.order[0] === "vault" && r.payload.layout.order.length === 21 && r.payload.layout.hidden.includes("trade"), r.payload.layout);

/* --- stale layout self-heal: saved before dana-followup existed --- */
const staleOrder = X.MODULE_IDS.filter(id => id !== "dana-followup");
r = await call("POST", { order: staleOrder, hidden: [] });
check("stale save (no dana-followup) accepted", r.statusCode === 200 && r.payload.ok === true, r);
check("dana-followup healed in at registry position on save",
  r.payload.layout.order.indexOf("dana-followup") === r.payload.layout.order.indexOf("opps") + 1, r.payload.layout.order);
r = await call("GET");
check("GET of a stale-shaped layout returns dana-followup next to opps",
  r.payload.layout.order.indexOf("dana-followup") === r.payload.layout.order.indexOf("opps") + 1, r.payload.layout.order);

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

/* --- the consolidated surface (static page checks) ---
   One office only: desk/office.html's "Your office" grid carries
   the Organizer controls, desk/organizer.html is just a redirect
   to it, and the desk.js registry lists no separate module. */
const officeHtml = readFileSync(new URL("../desk/office.html", import.meta.url), "utf8");
const organizerHtml = readFileSync(new URL("../desk/organizer.html", import.meta.url), "utf8");
const deskJs = readFileSync(new URL("../desk/desk.js", import.meta.url), "utf8");
check("office.html grid carries the controls", officeHtml.includes('id="org-status"') && officeHtml.includes('id="org-reset"') && officeHtml.includes('id="org-groups"') && officeHtml.includes('id="org-hidden"'), null);
check("office.html wires drag, save and reset to the layout API", officeHtml.includes("dragstart") && officeHtml.includes("drop") && officeHtml.includes("/api/office-layout") && officeHtml.includes("action: 'reset'"), null);
check("office.html has no dead grid and no link to the old page", !officeHtml.includes('id="office-modules"') && !officeHtml.includes("/desk/organizer.html"), null);
check("organizer.html redirects to office.html", organizerHtml.includes("/desk/office.html") && (organizerHtml.includes("location.replace") || organizerHtml.includes('http-equiv="refresh"')), null);
check("organizer.html is only a redirect (no module grid left)", !organizerHtml.includes("org-groups") && !organizerHtml.includes("OFFICE_MODULES"), null);
check("desk.js registry has no organizer module", !deskJs.includes("id: 'organizer'") && !deskJs.includes('id:"organizer"'), null);
const deskIds = [...deskJs.matchAll(/\{ id: '([a-z0-9-]+)',/g)].map(m => m[1]);
check("desk.js registry and API allowlist agree exactly (19 ids)", deskIds.length === X.MODULE_IDS.length && deskIds.every(id => X.MODULE_IDS.includes(id)), deskIds);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll office-layout tests passed.");
