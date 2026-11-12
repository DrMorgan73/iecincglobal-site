/* Local test suite for the 2026-11-12 questionnaire live-walk desk
   fixes (Defects 2–4):

   Defect 2 — desk/data-builder.html must not load looking pre-filled:
   no bare-numeric placeholders in the intake form, text placeholders
   are labeled "Example: ", and the form states a new asset starts
   empty (greyed hint text is never data, never saved).
   Defect 3 — desk/index.html exists and redirects /desk/ to the
   Suite home at "/" (the Desk home), so a signed-in /desk/ no longer
   404s; middleware still gates unauthenticated /desk/* to login.
   Defect 4 — desk/questionnaire-submissions.html no longer claims
   the info@ notification email is blocked on Resend domain
   verification (verified 2026-11-11; notifications live).

   Static file checks only — no server, no network.
   Run: node scripts/desk-walk-fixes.test.mjs   (exit 1 on failure) */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(ROOT, p), "utf8");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok — ${name}`); }
  else { failed++; console.log(`  FAIL — ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); }
}

/* ---- Defect 2: the builder form starts empty ---- */
const builder = read("desk/data-builder.html");
for (const ghost of ["placeholder:'25'", 'placeholder:"25"', "placeholder:'40'", "placeholder:'1'", "placeholder:'12'", "placeholder:'66'", "placeholder:'10'"]) {
  check(`no bare-numeric ghost placeholder ${ghost}`, !builder.includes(ghost));
}
check("medical example text is labeled as an example", builder.includes("Example: Pain management; physical therapy"));
check("non-medical example text is labeled as an example", builder.includes("Example: Gas / convenience; home services"));
check("numeric hints are words, not ghost values", builder.includes("placeholder:'Years of records'") && builder.includes("placeholder:'Full-time employees'") && builder.includes("placeholder:'Number of locations'"));
check("the form states a new asset starts empty and hints never save", /A new asset starts <b>empty<\/b>/.test(builder) && /never saved/.test(builder));

/* ---- Defect 3: /desk/ resolves to the Desk home ---- */
check("desk/index.html exists", existsSync(join(ROOT, "desk/index.html")));
const deskIndex = read("desk/index.html");
check("desk/index.html redirects to the Suite home at /", /location\.replace\("\/" \+ location\.search\)/.test(deskIndex) && /http-equiv="refresh" content="0; url=\/"/.test(deskIndex));
check("desk/index.html carries a visible fallback link home", /<a href="\/">/.test(deskIndex));
check("desk/index.html is noindex like the rest of the desk", /noindex/.test(deskIndex));
const middleware = read("middleware.js");
check("middleware still routes /desk/* (login gate unchanged)", middleware.includes("'/desk/:path*'") && middleware.includes("pathname === '/desk/login.html'") && middleware.includes("'/desk/login.html', request.url"));

/* ---- Defect 4: the submissions board states the true email state ---- */
const board = read("desk/questionnaire-submissions.html");
check("board no longer claims notifications are blocked", !/blocked on Resend/.test(board));
check("board states notifications are live since the 2026-11-11 verification", /notification email to\s*\n?\s*info@iecincglobal\.com, live since the Resend domain was verified on 2026-11-11/.test(board.replace(/\s+/g, " ")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
