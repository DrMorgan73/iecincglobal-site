/* =====================================================================
   IEC Office — Demo Control Portal API (IEC Desk, DrMorgan's order
   2026-11-05: one portal in the IEC Office controls demo users AND
   permissions for ALL assets — the ones with demos today and every
   future asset).

   POST /api/demo-admin   (JSON body, desk_session cookie required)
     { action: "list" }
     { action: "invite", asset, email, name }
     { action: "resend", asset, email }
     { action: "status", asset, email, status }   status: paused|active|revoked
     { action: "mark-nda-signed", asset, email, name?, basis?, signedDate? }

   AUTH: the Desk session cookie, verified with exactly the scheme
   middleware.js / api/desk-login.js use (HMAC-SHA256 over
   "<user>.<exp>", DESK_SESSION_SECRET). No session → 401.

   HOW CONTROL WORKS: each live asset's demo keeps its provisioning.js
   store as the single source of truth (the same file its portal gate
   reads). This function reads and edits those files through the
   GitHub Contents API — byte-preserving inserts and single-field
   status flips, one retry on a sha conflict — exactly the pattern
   the assets' own /api/demo-provision endpoints shipped with. A
   commit triggers the asset's redeploy, which is what enforces the
   new status. Activation emails go through Resend from the
   onboarding sender with the asset's ORG signature (no personal
   name), mirroring the assets' own activation emails: one-time link,
   signer sets their own password, links do not expire — control is
   administrative, through the status field:
     invited / active / paused (login blocked, account preserved) /
     revoked (link AND login dead).
   "invited" is never a settable target: access moves forward only,
   and revoked → invited is expressly forbidden.

   PERMISSION MATRIX: "list" also returns the union of people by
   email across every live asset, each cell that asset's status or
   null — the cross-asset permission view the Desk page renders.

   NDA-FIRST INVITES (DrMorgan's standing rule, 2026-11-05: "if
   I'm sending invitation, NDA send first; once executed, the link
   follows"): "invite" NO LONGER provisions an account. It records
   the person per asset in the pre-state "nda_sent" (Office Blob
   doc demo-invites.json, api/_demo-invites-store.js) and sends ONE
   email per asset carrying that asset's confidentiality agreement
   to sign — the call to action is the asset's existing public
   signing route (registry ndaRoute). The flip to "invited" is
   automatic and happens on the ASSET side: the website signing
   trigger (ALL FIVE assets — registry ndaTrigger:true since the
   2026-11-05 circuit completion: CURAVIA wired through the
   recorded-signing flow, INSNAPP and IEC Docs gained their own
   /legal/cnda pages with record-first submit + trigger) or the
   verified-countersignature flow writes the entry into the asset's
   provisioning store, which "list" already reads, so the matrix
   cell takes over from "nda_sent" on its own. Only a FUTURE asset
   with no public NDA signing route (registry ndaRoute:null) is
   held by invite — no email, no record, no provisioning — with
   reason "no_nda_route". "resend" on an nda_sent cell
   re-sends the NDA email; on a provisioned cell it keeps its
   original meaning (re-send the activation link). Every NDA
   email attempt's outcome is stamped on the invite record
   (lastEmailStatus / lastEmailReason / lastEmailAt — the store's
   delivery status, 2026-11-09) and "list" exposes it, so a
   failed send stays visible on the matrix.

   MARK NDA SIGNED (DrMorgan's order, 2026-11-12): a signer who
   returns a PAPER agreement (verified by IEC outside the web
   signing flow) never trips the asset-side trigger, so their
   cell would sit at "nda_sent" forever. "mark-nda-signed"
   records the signed state on that person's invite record for
   that ONE asset (signedDate / signedBasis / markedBy /
   markedAt — the store's markNdaInviteSigned; an attestation
   about the paper, never a fabricated web-signing record), then
   provisions the demo the same way the asset-side trigger
   would: a fresh "invited" entry in the asset's provisioning
   store plus the activation email. The signed record is written
   FIRST and stands whatever provisioning does; when no entry
   can be created (the asset's Office key unset, the store
   unreadable) the response and the matrix say so honestly —
   state "nda_signed", provisioning outcome + reason — and the
   cell shows NDA SIGNED, never a faked "invited". Re-marking an
   already-signed record is the provisioning retry: idempotent,
   no duplicate entry, no second activation email when an entry
   already stands.

   ASSET REGISTRY: live entries carry repo/path/token-env. A future
   qualifying demo (website + application — the scope rule) joins
   with one live registry entry + its env token; nothing about the
   portal changes. Boston Pain Clinic is a strategic partner, NOT
   an IEC asset — it is never listed here.

   FAIL-CLOSED, PER ASSET: a missing per-asset GitHub token blocks
   THAT asset only — its actions answer 503
   { error: "not_configured" } and nothing is read or written for
   it, while "list" still serves every configured asset and reports
   the unconfigured one as configured:false (its store unread, its
   matrix cells empty). A missing Resend key never blocks a commit:
   the account is created and the outcome reports emailed:false /
   error "email_failed" (never a silent rollback), mirroring the
   demo-provision endpoints.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET            (already set for the Desk)
     DEMO_ADMIN_GITHUB_TOKEN_MEDEXEC  fine-grained GitHub token
                                    (DrMorgan73, medexec-site only,
                                    Contents read/write)
     DEMO_ADMIN_GITHUB_TOKEN_INSNAP   fine-grained GitHub token
                                    (drmohdmorgan-del, insnap-job-
                                    engine only, Contents read/write)
     DEMO_ADMIN_GITHUB_TOKEN_CURAVIA  fine-grained GitHub token
                                    (DrMorgan73, getcuravia-site
                                    only, Contents read/write)
     DEMO_ADMIN_GITHUB_TOKEN_INSNAPP  fine-grained GitHub token
                                    (drmohdmorgan-del, inssnap-del
                                    only, Contents read/write)
     DEMO_ADMIN_GITHUB_TOKEN_IECDOCS  fine-grained GitHub token
                                    (DrMorgan73, iec-docs only,
                                    Contents read/write)
     DEMO_ADMIN_RESEND_API_KEY      Resend sending key
     BLOB_READ_WRITE_TOKEN          (already set for the Office —
                                    the nda_sent invite records live
                                    in the same Blob store)

   SECURITY: activation tokens from the stores are used only to
   build the emailed activation link. They are never logged and
   never returned — "list" exposes email, name, status, issuedAt.

   MONITORING (2026-11-05): successful invite / resend / status
   actions also record an activity event (nda_sent for an NDA
   invite, invite_sent for an activation send, status_changed) in
   the Office activity store through
   api/_demo-activity-store.js — the same store the asset demos
   forward to via POST /api/demo-activity. Emission is best-effort:
   the writer never throws and a missing Blob token is a logged
   NO-OP, so a control action is never failed by its audit trail.

   ACCEPTED MERGE (2026-11-05, DrMorgan: "Invited should change to
   Accepted, loged in /off"): activation is recorded by the asset
   demo gates (their effective status + an "activated" event in the
   central activity store) — nothing rewrites the provisioning
   store on activation, so a stored entry can sit at "invited"
   forever while the person is in fact in. "list" therefore merges
   the two records at read time: a stored "invited" entry with a
   real (non-seed) "activated" or "login" activity event for the
   same asset + email is reported as "active" — which the Desk
   renders as ACCEPTED — and flagged acceptedFromActivity so the
   payload shows why. Administrative states always win: paused /
   revoked / nda_sent are reported exactly as stored, events or
   not, and nothing here ever writes to a store. The merge reads a
   90-day activity window; it is fail-soft — an unconfigured or
   failing activity store leaves the stored statuses untouched
   and never fails the list.
   ===================================================================== */

import crypto from "node:crypto";
import vm from "node:vm";
import {
  appendActivityEvent,
  readActivityEvents,
  activityConfigured,
  normalizeAssetId
} from "./_demo-activity-store.js";
import {
  invitesConfigured,
  readInvites,
  findInvite,
  upsertNdaInvite,
  touchNdaInvite,
  stampNdaInviteEmail,
  markNdaInviteSigned
} from "./_demo-invites-store.js";

/* ------------------------------------------------------------------ */
/* Org signatures for system mail (copied from the assets' own single */
/* sources: medexec-site api/_signature.js and insnap-job-engine      */
/* src/lib/demo-signature.js — org variant, logo, no personal name).  */
/* ------------------------------------------------------------------ */

const MEDEXEC_SIGNATURE_TEXT = [
  "MEDEXEC · IEC, Inc.",
  "857-867-1767",
  "info@getmedexec.com"
].join("\n");

const MEDEXEC_SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
  '<tr><td><img src="https://getmedexec.com/logo.png" width="140" alt="MEDEXEC" style="display:block;border:0"></td></tr>',
  '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
  "<strong>MEDEXEC · IEC, Inc.</strong><br>",
  '<a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
  '<a href="mailto:info@getmedexec.com" style="color:#1A1A1A;text-decoration:none">info@getmedexec.com</a>',
  "</td></tr>",
  "</table>"
].join("");

const INSNAP_SIGNATURE_TEXT = [
  "InSnap · IEC, Inc.",
  "857-867-1767",
  "info@iecincglobal.com"
].join("\n");

const INSNAP_SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
  '<tr><td><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="140" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
  '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
  "<strong>InSnap · IEC, Inc.</strong><br>",
  '<a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
  '<a href="mailto:info@iecincglobal.com" style="color:#1A1A1A;text-decoration:none">info@iecincglobal.com</a>',
  "</td></tr>",
  "</table>"
].join("");

/* CURAVIA, INSNAPP and IEC Docs all carry the IEC logo (the platform
   operator's) in their org signatures — copied from getcuravia-site
   api/_signature.js, inssnap-del apps/web/lib/demo-signature.js and
   iec-docs api/_signature.js; same shape as the InSnap one above. */
function iecLogoSignature(orgLine, email) {
  const text = [orgLine, "857-867-1767", email].join("\n");
  const html = [
    '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
    '<tr><td><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="140" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
    '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
    `<strong>${orgLine}</strong><br>`,
    '<a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
    `<a href="mailto:${email}" style="color:#1A1A1A;text-decoration:none">${email}</a>`,
    "</td></tr>",
    "</table>"
  ].join("");
  return { text, html };
}

const CURAVIA_SIGNATURE = iecLogoSignature("CURAVIA · IEC, Inc.", "info@getcuravia.com");
const INSNAPP_SIGNATURE = iecLogoSignature("INSNAPP · IEC, Inc.", "info@iecincglobal.com");
const IECDOCS_SIGNATURE = iecLogoSignature("IEC Docs · IEC, Inc.", "info@iecincglobal.com");

/* ------------------------------------------------------------------ */
/* Asset registry                                                      */
/* ------------------------------------------------------------------ */

const ASSETS = [
  {
    id: "medexec",
    name: "MEDEXEC",
    live: true,
    repo: "DrMorgan73/medexec-site",
    path: "demo/provisioning.js",
    tokenEnv: "DEMO_ADMIN_GITHUB_TOKEN_MEDEXEC",
    activationBase: "https://getmedexec.com/demo/activate/?token=",
    portalUrl: "https://getmedexec.com/demo/",
    liveUrl: "https://getmedexec.com/demo/provisioning.js",
    from: "MEDEXEC Demo Portal <onboarding@resend.dev>",
    /* NDA-first invite: the public signing route the invite email
       sends people to, and whether a signing there provisions the
       demo automatically (asset-side trigger armed). */
    ndaRoute: "https://getmedexec.com/#nda",
    ndaTrigger: true,
    committer: { name: "DrMorgan73", email: "DrMorgan73@users.noreply.github.com" },
    signatureText: MEDEXEC_SIGNATURE_TEXT,
    signatureHtml: MEDEXEC_SIGNATURE_HTML,
    emailSubject: "Your MEDEXEC demo account is ready — activate your access",
    emailIntroText:
      "Your MEDEXEC demo account has been created. The demo is the exact MEDEXEC dashboard as live HTML, showing the full workflow — from intake to the expert report — on synthetic cases only. No real patient data is used.",
    emailIntroHtml:
      "Your MEDEXEC demo account has been created. The demo is the exact MEDEXEC dashboard as live HTML, showing the full workflow — from intake to the expert report — on synthetic cases only. No real patient data is used.",
    emailClosingText:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@getmedexec.com.",
    emailClosingHtml:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@getmedexec.com."
  },
  {
    id: "insnap",
    name: "InSnap",
    live: true,
    repo: "drmohdmorgan-del/insnap-job-engine",
    path: "public/demo/provisioning.js",
    tokenEnv: "DEMO_ADMIN_GITHUB_TOKEN_INSNAP",
    activationBase: "https://insnap-job-engine.vercel.app/demo/activate/?token=",
    portalUrl: "https://insnap-job-engine.vercel.app/demo",
    liveUrl: "https://insnap-job-engine.vercel.app/demo/provisioning.js",
    from: "InSnap Demo Portal <onboarding@resend.dev>",
    ndaRoute: "https://insnap-job-engine.vercel.app/legal/cnda",
    ndaTrigger: true,
    committer: { name: "drmohdmorgan-del", email: "drmohdmorgan-del@users.noreply.github.com" },
    signatureText: INSNAP_SIGNATURE_TEXT,
    signatureHtml: INSNAP_SIGNATURE_HTML,
    emailSubject: "Your InSnap demo account is ready — activate your access",
    emailIntroText:
      "Thank you for signing the confidentiality agreement. Your InSnap Demo Portal account has been created. The demo is the exact InSnap workflow — the dispatch board, the client app, and the Pro app moving through one job together — on a synthetic case only. No real firms, workers, or jobs are used.",
    emailIntroHtml:
      "Thank you for signing the confidentiality agreement. Your InSnap Demo Portal account has been created. The demo is the exact InSnap workflow — the dispatch board, the client app, and the Pro app moving through one job together — on a synthetic case only. No real firms, workers, or jobs are used.",
    emailClosingText:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@iecincglobal.com.",
    emailClosingHtml:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@iecincglobal.com."
  },
  /* CURAVIA, INSNAPP and IEC Docs went live in the registry
     2026-11-05, once their demo portals were built to the same
     blueprint (provisioning store, one-time activation link,
     invited/active/paused/revoked, login notifications). Registry
     id note: IEC Docs is "iec-docs" here; the activity store
     canonicalizes it to its monitoring id "iecdocs" (see
     api/_demo-activity-store.js). */
  {
    id: "curavia",
    name: "CURAVIA",
    live: true,
    repo: "DrMorgan73/getcuravia-site",
    path: "demo/provisioning.js",
    tokenEnv: "DEMO_ADMIN_GITHUB_TOKEN_CURAVIA",
    activationBase: "https://getcuravia.com/demo/activate/?token=",
    portalUrl: "https://getcuravia.com/demo/",
    liveUrl: "https://getcuravia.com/demo/provisioning.js",
    from: "CURAVIA Demo Portal <onboarding@resend.dev>",
    /* Signing route: the Mutual NDA section of getcuravia.com.
       Trigger ARMED 2026-11-05: the recorded-signing flow (the
       shared /api/nda/submit the CURAVIA page posts to) calls
       CURAVIA's /api/demo-provision for curavia signings right
       after the signing record lands, so an executed NDA flips
       this cell to "invited" on its own. */
    ndaRoute: "https://getcuravia.com/#signing",
    ndaTrigger: true,
    committer: { name: "DrMorgan73", email: "DrMorgan73@users.noreply.github.com" },
    signatureText: CURAVIA_SIGNATURE.text,
    signatureHtml: CURAVIA_SIGNATURE.html,
    emailSubject: "Your CURAVIA demo account is ready — activate your access",
    emailIntroText:
      "Your CURAVIA demo account has been created. The demo is the CURAVIA Suite and the patient app as live HTML, showing one clinic day end to end — booking, intake, the visit, the scribe's summary, billing review — on a synthetic case only. No real patient data is used.",
    emailIntroHtml:
      "Your CURAVIA demo account has been created. The demo is the CURAVIA Suite and the patient app as live HTML, showing one clinic day end to end — booking, intake, the visit, the scribe's summary, billing review — on a synthetic case only. No real patient data is used.",
    emailClosingText:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@getcuravia.com.",
    emailClosingHtml:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@getcuravia.com."
  },
  {
    id: "insnapp",
    name: "INSNAPP",
    live: true,
    repo: "drmohdmorgan-del/inssnap-del",
    path: "apps/web/public/demo/provisioning.js",
    tokenEnv: "DEMO_ADMIN_GITHUB_TOKEN_INSNAPP",
    activationBase: "https://www.inssnapp.com/demo/activate/?token=",
    portalUrl: "https://www.inssnapp.com/demo",
    liveUrl: "https://www.inssnapp.com/demo/provisioning.js",
    from: "INSNAPP Demo Portal <onboarding@resend.dev>",
    /* CNDA signing page built 2026-11-05 at /legal/cnda (full IEC
       CNDA, record-first submit, in-process demo-provision
       trigger — the InSnap pattern), so NDA-first invites run the
       full circuit for INSNAPP too. */
    ndaRoute: "https://www.inssnapp.com/legal/cnda",
    ndaTrigger: true,
    committer: { name: "drmohdmorgan-del", email: "drmohdmorgan-del@users.noreply.github.com" },
    signatureText: INSNAPP_SIGNATURE.text,
    signatureHtml: INSNAPP_SIGNATURE.html,
    emailSubject: "Your INSNAPP demo account is ready — activate your access",
    emailIntroText:
      "Thank you for signing the confidentiality agreement. Your INSNAPP Demo Portal account has been created. The demo is the exact INSNAPP workflow — the resident, prospect, and broker mobile apps and the Management and Control Center web views following one showing from request to live lead — on a synthetic case only. No real tenants, prospects, brokers, or properties are used.",
    emailIntroHtml:
      "Thank you for signing the confidentiality agreement. Your INSNAPP Demo Portal account has been created. The demo is the exact INSNAPP workflow — the resident, prospect, and broker mobile apps and the Management and Control Center web views following one showing from request to live lead — on a synthetic case only. No real tenants, prospects, brokers, or properties are used.",
    emailClosingText:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@iecincglobal.com.",
    emailClosingHtml:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@iecincglobal.com."
  },
  {
    id: "iec-docs",
    name: "IEC Docs",
    live: true,
    repo: "DrMorgan73/iec-docs",
    path: "public/demo/provisioning.js",
    tokenEnv: "DEMO_ADMIN_GITHUB_TOKEN_IECDOCS",
    activationBase: "https://iec-docs.vercel.app/demo/activate/?token=",
    portalUrl: "https://iec-docs.vercel.app/demo",
    liveUrl: "https://iec-docs.vercel.app/demo/provisioning.js",
    from: "IEC Docs Demo Portal <onboarding@resend.dev>",
    /* CNDA signing page built 2026-11-05 at /legal/cnda (full IEC
       CNDA, record-first submit into Blob, in-process
       demo-provision trigger — the InSnap pattern), so NDA-first
       invites run the full circuit for IEC Docs too. */
    ndaRoute: "https://iec-docs.vercel.app/legal/cnda",
    ndaTrigger: true,
    committer: { name: "DrMorgan73", email: "DrMorgan73@users.noreply.github.com" },
    signatureText: IECDOCS_SIGNATURE.text,
    signatureHtml: IECDOCS_SIGNATURE.html,
    emailSubject: "Your IEC Docs demo account is ready — activate your access",
    emailIntroText:
      "Your IEC Docs demo account has been created. The demo shows the real IEC Docs screens — library, viewer, PDF tools, conversion, de-identification, e-sign and the vault — on synthetic documents only. No real documents are used.",
    emailIntroHtml:
      "Your IEC Docs demo account has been created. The demo shows the real IEC Docs screens — library, viewer, PDF tools, conversion, de-identification, e-sign and the vault — on synthetic documents only. No real documents are used.",
    emailClosingText:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@iecincglobal.com.",
    emailClosingHtml:
      "The activation link is one-time: it stops working once you have set your password. If you need it reissued, or your access changed at any time, contact us at info@iecincglobal.com."
  }
];

const SETTABLE_STATUSES = ["paused", "active", "revoked"];

/* ------------------------------------------------------------------ */
/* Desk session verification — mirrors middleware.js exactly           */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret, data) {
  const key = await crypto.webcrypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(await crypto.webcrypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function validSession(value) {
  const secret = process.env.DESK_SESSION_SECRET;
  if (!secret) return false;
  const parts = String(value).split(".");
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = await hmacHex(secret, user + "." + exp);
  return timingSafeEqual(sig, expected);
}

/* ------------------------------------------------------------------ */
/* Small helpers (mirroring the demo-provision endpoints)              */
/* ------------------------------------------------------------------ */

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function plausibleEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return new Promise(resolve => {
    let data = "";
    if (typeof req.on !== "function") return resolve({});
    req.on("data", c => { data += c; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function reply(res, code, obj) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(code).json(obj);
  }
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

/* "2026-11-05T06:05:00-05:00" — America/New_York wall time with its
   UTC offset, matching the format of the existing entries. */
function easternIso(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  let offMin = Math.round((asUTC - date.getTime()) / 60000);
  const sign = offMin < 0 ? "-" : "+";
  offMin = Math.abs(offMin);
  const oh = String(Math.floor(offMin / 60)).padStart(2, "0");
  const om = String(offMin % 60).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${sign}${oh}:${om}`;
}

/* ------------------------------------------------------------------ */
/* Provisioning store: parse + byte-preserving edits                   */
/* ------------------------------------------------------------------ */

/* The stores are our own controlled artifacts, so evaluating one in
   an empty vm sandbox to read the constant is safe and robust to
   comments/formatting inside the array (same as demo-provision). */
function parseProvisioning(source) {
  const sandbox = {};
  vm.createContext(sandbox);
  const list = vm.runInContext(
    String(source || "") + "\n;DEMO_PROVISIONED_ACCOUNTS;",
    sandbox,
    { timeout: 1000 }
  );
  if (!Array.isArray(list)) throw new Error("provisioning_parse_failed");
  return list;
}

/* Insert a new entry just before the array's closing bracket,
   leaving every existing byte in place. */
function insertEntry(source, entry) {
  const text = String(source);
  const close = text.lastIndexOf("\n];");
  if (close < 0) throw new Error("provisioning_shape_unexpected");
  const entryText =
    ",\n  {\n" +
    `    email: ${JSON.stringify(entry.email)},\n` +
    `    name: ${JSON.stringify(entry.name)},\n` +
    `    token: ${JSON.stringify(entry.token)},\n` +
    `    status: ${JSON.stringify(entry.status)},\n` +
    `    issuedAt: ${JSON.stringify(entry.issuedAt)}\n` +
    "  }";
  return text.slice(0, close) + entryText + text.slice(close);
}

/* Flip ONE entry's status value in place: locate the entry by its
   email line, then replace the first status value that follows it
   (bounded by the next entry / the array close). Every other byte
   of the file survives untouched. */
function setStatusInSource(source, email, newStatus) {
  const text = String(source);
  const needle = `email: ${JSON.stringify(email)}`;
  const emailPos = text.indexOf(needle);
  if (emailPos < 0) throw new Error("entry_not_found");
  const nextEntry = text.indexOf("\n    email:", emailPos + needle.length);
  const arrayClose = text.lastIndexOf("\n];");
  const bound = nextEntry >= 0 ? nextEntry : arrayClose;
  const segment = text.slice(emailPos, bound);
  const m = segment.match(/status: "[a-z]+"/);
  if (!m) throw new Error("entry_status_not_found");
  const at = emailPos + m.index;
  return text.slice(0, at) + `status: ${JSON.stringify(newStatus)}` + text.slice(at + m[0].length);
}

/* ------------------------------------------------------------------ */
/* GitHub Contents API (each asset's repo is its demo user store)      */
/* ------------------------------------------------------------------ */

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "iec-office-demo-admin"
  };
}

async function ghGetFile(asset, token) {
  const r = await fetch(
    `https://api.github.com/repos/${asset.repo}/contents/${asset.path}`,
    { headers: ghHeaders(token) }
  );
  if (!r.ok) throw new Error(`github_get_${r.status}`);
  const data = await r.json();
  const source = Buffer.from(String(data.content || ""), "base64").toString("utf8");
  return { source, sha: data.sha };
}

async function ghPutFile(asset, token, sha, source, message) {
  const r = await fetch(
    `https://api.github.com/repos/${asset.repo}/contents/${asset.path}`,
    {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message,
        sha,
        content: Buffer.from(source, "utf8").toString("base64"),
        committer: asset.committer,
        author: asset.committer
      })
    }
  );
  if (!r.ok) {
    const err = new Error(`github_put_${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json().catch(() => ({}));
}

/* Read → plan → commit, with one retry on a sha conflict (a
   concurrent commit), re-planning from the fresh file. The plan
   callback returns { result } for a no-write outcome or
   { write, message, result } to commit. */
async function mutateStore(asset, plan) {
  const token = process.env[asset.tokenEnv] || "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { source, sha } = await ghGetFile(asset, token);
    const list = parseProvisioning(source);
    const step = plan(list, source);
    if (!step.write) return step.result;
    try {
      await ghPutFile(asset, token, sha, step.write, step.message);
      return step.result;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && attempt === 0) continue;
      throw e;
    }
  }
  throw new Error("github_conflict");
}

async function readStore(asset) {
  const token = process.env[asset.tokenEnv] || "";
  const { source } = await ghGetFile(asset, token);
  return parseProvisioning(source);
}

/* ------------------------------------------------------------------ */
/* Activation email — mirrors each asset's own activation email        */
/* ------------------------------------------------------------------ */

function buildActivationEmail(asset, name, token) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const link = asset.activationBase + token;
  const text = [
    `Dear ${first},`,
    "",
    asset.emailIntroText,
    "",
    "Activate your account here:",
    link,
    "",
    "Three steps:",
    "1. Open the link.",
    "2. Set your own password — we never send passwords by email.",
    `3. Sign in at ${asset.portalUrl} with this email address and your new password.`,
    "",
    asset.emailClosingText,
    "",
    asset.signatureText
  ].join("\n");
  const html = [
    `<p>Dear ${escapeHtml(first)},</p>`,
    `<p>${asset.emailIntroHtml}</p>`,
    `<p>Activate your account here:<br><a href="${link}">${link}</a></p>`,
    "<p>Three steps:</p>",
    "<ol>",
    "<li>Open the link.</li>",
    "<li>Set your own password — we never send passwords by email.</li>",
    `<li>Sign in at ${asset.portalUrl} with this email address and your new password.</li>`,
    "</ol>",
    `<p>${asset.emailClosingHtml}</p>`,
    asset.signatureHtml
  ].join("\n");
  return { subject: asset.emailSubject, text, html, link };
}

/* { sent:true, id } | { sent:false, reason } — never throws. */
async function sendActivationEmail(asset, name, email, token) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "not_configured" };
  const mail = buildActivationEmail(asset, name, token);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: asset.from, to: [email], subject: mail.subject, text: mail.text, html: mail.html })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true, id: data.id || null };
  } catch (e) {
    return { sent: false, reason: "send_failed" };
  }
}

/* ------------------------------------------------------------------ */
/* NDA invite email — the NDA-FIRST invitation (2026-11-05 rule).      */
/* One per asset: the call to action is the asset's own public         */
/* signing route; the copy states plainly that the demo access link    */
/* follows automatically once the agreement is executed. Same org      */
/* signature standard as the activation emails — never a personal      */
/* name, and NO activation link or token is ever in this email.        */
/* ------------------------------------------------------------------ */

function buildNdaEmail(asset, name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const subject = `First step for your ${asset.name} demo: sign the confidentiality agreement`;
  const text = [
    `Dear ${first},`,
    "",
    `You are invited to review the ${asset.name} demo. Access is protected by a mutual confidentiality agreement, so the first step is the NDA — no demo account is created before it is signed.`,
    "",
    `Please review and sign the ${asset.name} confidentiality agreement here:`,
    asset.ndaRoute,
    "",
    "Sign the NDA first; your demo access link follows automatically once it's executed. The link is one-time and lets you set your own password — we never send passwords by email.",
    "",
    `Questions? Contact us any time — and if you were not expecting this invitation, you can simply ignore this email.`,
    "",
    asset.signatureText
  ].join("\n");
  const html = [
    `<p>Dear ${escapeHtml(first)},</p>`,
    `<p>You are invited to review the ${asset.name} demo. Access is protected by a mutual confidentiality agreement, so the first step is the NDA — no demo account is created before it is signed.</p>`,
    `<p>Please review and sign the ${asset.name} confidentiality agreement here:<br><a href="${asset.ndaRoute}">${asset.ndaRoute}</a></p>`,
    "<p>Sign the NDA first; your demo access link follows automatically once it's executed. The link is one-time and lets you set your own password — we never send passwords by email.</p>",
    "<p>Questions? Contact us any time — and if you were not expecting this invitation, you can simply ignore this email.</p>",
    asset.signatureHtml
  ].join("\n");
  return { subject, text, html };
}

/* { sent:true, id } | { sent:false, reason } — never throws. */
async function sendNdaEmail(asset, name, email) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "not_configured" };
  const mail = buildNdaEmail(asset, name);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: asset.from, to: [email], subject: mail.subject, text: mail.text, html: mail.html })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true, id: data.id || null };
  } catch (e) {
    return { sent: false, reason: "send_failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Activity monitoring — Office-side events                            */
/* ------------------------------------------------------------------ */

/* Record one of this portal's own actions in the central activity
   store. Best-effort: appendActivityEvent never throws, and its
   false return (store not configured / write failed) is only a
   log line here — the control action's outcome stands. */
async function emitOfficeEvent(asset, email, name, event, detail) {
  try {
    const stored = await appendActivityEvent({
      asset: asset.id,
      email,
      name: name || "",
      event,
      detail,
      ts: new Date().toISOString(),
      seed: false
    });
    if (!stored) console.log(`[demo-admin] activity event ${event} for ${asset.name} not recorded (activity store unavailable).`);
  } catch (e) {
    console.error(`[demo-admin] activity emission FAILED: ${e && e.message}`);
  }
}

/* Persist an NDA email attempt's outcome on the invite record
   (lastEmailStatus / lastEmailReason / lastEmailAt — the store's
   stampNdaInviteEmail), so a failed send stays visible on the
   matrix instead of living only in this response. Best-effort:
   the email outcome is the action's result either way, so a stamp
   failure is logged, never fatal, and never masks the send's own
   outcome. The invite path stamps WITHOUT bumping the send
   counters — upsertNdaInvite already counted the attempt. */
async function stampInviteOutcome(asset, email, sent) {
  try {
    await stampNdaInviteEmail(email, asset.id, sent);
  } catch (e) {
    console.error(`[demo-admin] invite email-outcome stamp FAILED for ${asset.name}: ${e && e.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Accepted merge — stored "invited" + real activation activity        */
/* ------------------------------------------------------------------ */

/* The event types that prove a person accepted their invitation:
   they redeemed the activation link ("activated") or they signed
   in ("login" — impossible before activation). Anything else
   (step views, failed attempts, Office-side events) proves
   nothing about acceptance. */
const ACCEPTANCE_EVENTS = ["activated", "login"];
const ACCEPTANCE_WINDOW_DAYS = 90;

/* The set of "<monitoring asset id>|<email>" pairs with acceptance
   evidence in an event list. Seed-flagged events are ignored: a
   seed identity exercising a demo says nothing about an invitee. */
function acceptanceKeys(events) {
  const keys = new Set();
  for (const evt of events || []) {
    if (!evt || evt.seed === true) continue;
    if (!ACCEPTANCE_EVENTS.includes(String(evt.event || "").toLowerCase())) continue;
    const asset = normalizeAssetId(evt.asset);
    const email = normalizeEmail(evt.email);
    if (!asset || !email) continue;
    keys.add(`${asset}|${email}`);
  }
  return keys;
}

/* Upgrade, in place, the payload view of every stored "invited"
   account that carries acceptance evidence: status becomes
   "active" (the Desk renders it ACCEPTED) and the entry is
   flagged acceptedFromActivity. Every other stored status —
   paused / revoked / nda_sent / active — is left exactly as
   stored: administrative control always wins. Fail-soft by
   design: an unconfigured activity store is a logged skip, and a
   read failure is logged and swallowed — the list still serves
   the stored statuses. Returns the number of upgraded entries. */
async function applyActivityAcceptance(accounts) {
  if (!activityConfigured()) {
    console.log("[demo-admin] accepted merge skipped — activity store not configured; stored statuses served as-is.");
    return 0;
  }
  let events;
  try {
    events = await readActivityEvents({ days: ACCEPTANCE_WINDOW_DAYS });
  } catch (e) {
    console.error(`[demo-admin] accepted merge FAILED to read activity (${e && e.message}); stored statuses served as-is.`);
    return 0;
  }
  const keys = acceptanceKeys(events);
  if (!keys.size) return 0;
  let upgraded = 0;
  for (const asset of ASSETS) {
    const monitoringId = normalizeAssetId(asset.id);
    for (const acct of accounts[asset.id] || []) {
      if (acct.status !== "invited") continue;
      if (!keys.has(`${monitoringId}|${acct.email}`)) continue;
      acct.status = "active";
      acct.acceptedFromActivity = true;
      upgraded++;
    }
  }
  if (upgraded) console.log(`[demo-admin] accepted merge: ${upgraded} invited entr${upgraded === 1 ? "y" : "ies"} reported as accepted from activity evidence.`);
  return upgraded;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/* What "list" may expose per account — never the activation token. */
function publicAccount(a) {
  return {
    email: normalizeEmail(a.email),
    name: String(a.name || ""),
    status: String(a.status || "").toLowerCase(),
    issuedAt: a.issuedAt || null,
    seed: !a.token
  };
}

/* The permission matrix: one row per person (union by email across
   live assets), each cell that asset's status or null. NDA-first
   invite records merge UNDER the same person: a cell with no
   provisioning entry shows the record's own state — "nda_sent",
   or "nda_signed" once the Desk has marked a verified paper
   signature (2026-11-12); a provisioned entry always wins over
   the invite record (the flip is the asset store gaining the
   entry — the record simply stops being the latest word on that
   cell). */
function buildMatrix(accounts, ndaRecords = []) {
  const liveAssets = ASSETS.filter(a => a.live);
  const people = new Map();
  const personFor = (email, name) => {
    if (!people.has(email)) {
      people.set(email, { email, name: name || "", cells: {}, seeds: {} });
    }
    const p = people.get(email);
    if (!p.name && name) p.name = name;
    return p;
  };
  for (const asset of liveAssets) {
    for (const acct of accounts[asset.id] || []) {
      const p = personFor(acct.email, acct.name);
      p.cells[asset.id] = acct.status;
      p.seeds[asset.id] = !!acct.seed;
    }
  }
  for (const rec of ndaRecords || []) {
    const asset = findAsset(rec.asset);
    if (!asset || !asset.live) continue;
    const email = normalizeEmail(rec.email);
    if (!email) continue;
    const p = personFor(email, rec.name);
    if (!(asset.id in p.cells)) {
      p.cells[asset.id] = String(rec.status || "").toLowerCase() === "nda_signed"
        ? "nda_signed"
        : "nda_sent";
    }
  }
  const rows = [...people.values()];
  for (const p of rows) {
    for (const a of ASSETS) {
      if (!(a.id in p.cells)) p.cells[a.id] = null;
      if (!(a.id in p.seeds)) p.seeds[a.id] = false;
    }
  }
  rows.sort((x, y) => (x.name || x.email).localeCompare(y.name || y.email));
  return rows;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

function findAsset(id) {
  return ASSETS.find(a => a.id === String(id || "")) || null;
}

/* Gate for any action on one asset: resolves the asset or answers
   the request itself (null = already answered). */
function gateAsset(res, body) {
  const asset = findAsset(body.asset);
  if (!asset) { reply(res, 400, { ok: false, error: "unknown_asset" }); return null; }
  if (!asset.live) { reply(res, 400, { ok: false, error: "asset_not_live" }); return null; }
  if (!process.env[asset.tokenEnv]) {
    console.log(`[demo-admin] NO-OP — ${asset.tokenEnv} is not configured for this project; nothing read or written for ${asset.name}.`);
    reply(res, 503, { ok: false, error: "not_configured" });
    return null;
  }
  return asset;
}

async function actionList(res) {
  const liveAssets = ASSETS.filter(a => a.live);
  /* Fail-closed is PER ASSET: an asset whose GitHub token is not
     set is reported configured:false with an unread store, and the
     list still serves every configured asset. */
  const configured = {};
  const accounts = {};
  for (const asset of liveAssets) {
    configured[asset.id] = !!process.env[asset.tokenEnv];
    if (!configured[asset.id]) {
      console.log(`[demo-admin] ${asset.name} not configured (${asset.tokenEnv} unset) — reported per-asset; other assets unaffected.`);
      accounts[asset.id] = [];
    }
  }
  try {
    for (const asset of liveAssets) {
      if (!configured[asset.id]) continue;
      accounts[asset.id] = (await readStore(asset)).map(publicAccount);
    }
  } catch (e) {
    console.error(`[demo-admin] list FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  /* Stored "invited" + real activation/login activity = accepted
     (the Desk renders "active" as ACCEPTED). Fail-soft: never
     blocks the list — see the Accepted merge section above. */
  await applyActivityAcceptance(accounts);
  /* NDA-first invite records merge into the matrix under the same
     people. A missing/unreadable invites store degrades to "no
     outstanding NDAs shown" — it never fails the list. */
  let ndaRecords = [];
  if (invitesConfigured()) {
    try {
      ndaRecords = await readInvites();
    } catch (e) {
      console.error(`[demo-admin] list: invites store read FAILED: ${e && e.message} — matrix served without nda_sent cells.`);
    }
  }
  return reply(res, 200, {
    ok: true,
    assets: ASSETS.map(a => ({
      id: a.id, name: a.name, live: a.live,
      configured: a.live ? configured[a.id] : false,
      ndaRoute: !!a.ndaRoute
    })),
    accounts,
    invites: ndaRecords.map(r => ({
      email: normalizeEmail(r.email),
      name: String(r.name || ""),
      asset: r.asset,
      status: String(r.status || "").toLowerCase() === "nda_signed" ? "nda_signed" : "nda_sent",
      sentAt: r.sentAt || null,
      lastSentAt: r.lastSentAt || null,
      sends: r.sends || 0,
      lastEmailStatus: r.lastEmailStatus || null,
      lastEmailReason: r.lastEmailReason || null,
      lastEmailAt: r.lastEmailAt || null,
      signedDate: r.signedDate || null,
      signedBasis: r.signedBasis || null,
      markedBy: r.markedBy || null,
      markedAt: r.markedAt || null
    })),
    matrix: buildMatrix(accounts, ndaRecords)
  });
}

/* NDA-FIRST (2026-11-05 rule): invite records the person in the
   "nda_sent" pre-state and emails the asset's NDA to sign. It
   NEVER writes to the asset's provisioning store — the account is
   created by the asset side once the NDA is executed. */
async function actionInvite(res, body) {
  const asset = gateAsset(res, body);
  if (!asset) return;
  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim().slice(0, 200);
  if (!plausibleEmail(email)) return reply(res, 400, { ok: false, error: "invalid_email" });
  if (!name) return reply(res, 400, { ok: false, error: "name_required" });

  /* Already provisioned on this asset? The NDA gate is behind
     them — report the standing state and send nothing. This also
     makes an invite that races the asset-side signing trigger
     safe: whoever's write lands first, the invite just reports
     the provisioned state. */
  let list;
  try {
    list = await readStore(asset);
  } catch (e) {
    console.error(`[demo-admin] invite FAILED for ${asset.name}: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  const existing = list.find(a => normalizeEmail(a.email) === email) || null;
  if (existing) {
    const status = String(existing.status || "invited").toLowerCase();
    return reply(res, 200, {
      ok: true, ndaSent: false, emailed: false,
      state: status, reason: `status_${status}`
    });
  }

  /* No public NDA signing route and no CNDA document on file:
     the NDA-first rule HOLDS this asset — nothing is recorded,
     nothing is emailed, nothing is provisioned. */
  if (!asset.ndaRoute) {
    console.log(`[demo-admin] ${asset.name} invite HELD for ${email}: no NDA signing route (NDA-first rule).`);
    return reply(res, 200, {
      ok: true, ndaSent: false, emailed: false, held: true,
      state: null, reason: "no_nda_route"
    });
  }

  /* Record first — the nda_sent record IS the invite's state —
     then send the NDA email. If the record cannot be written, no
     email goes out (an untracked NDA invite would be a promise
     the matrix cannot show). */
  if (!invitesConfigured()) {
    console.log("[demo-admin] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; the nda_sent invite cannot be recorded, so no NDA email was sent.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }
  let record;
  try {
    record = await upsertNdaInvite({ email, name, asset: asset.id });
  } catch (e) {
    console.error(`[demo-admin] invite record FAILED for ${asset.name}: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  const resent = (record.sends || 1) > 1;

  const sent = await sendNdaEmail(asset, name, email);
  await stampInviteOutcome(asset, email, sent);
  if (!sent.sent) {
    console.error(`[demo-admin] NDA email FAILED for ${asset.name} (${sent.reason}); the nda_sent record stands — Resend re-sends the NDA.`);
    return reply(res, 200, {
      ok: true, ndaSent: true, emailed: false, resent,
      state: "nda_sent", error: "email_failed", reason: sent.reason
    });
  }
  console.log(`[demo-admin] ${asset.name} NDA invite email sent to ${email} (Resend id ${sent.id || "?"}).`);
  await emitOfficeEvent(asset, email, name, "nda_sent",
    resent
      ? "NDA invite re-sent from IEC Office (NDA first — demo link follows on execution)"
      : "NDA invite sent from IEC Office (NDA first — demo link follows on execution)");
  return reply(res, 200, {
    ok: true, ndaSent: true, emailed: true, resent,
    state: "nda_sent", id: sent.id
  });
}

async function actionResend(res, body) {
  const asset = gateAsset(res, body);
  if (!asset) return;
  const email = normalizeEmail(body.email);
  if (!plausibleEmail(email)) return reply(res, 400, { ok: false, error: "invalid_email" });

  let list;
  try {
    list = await readStore(asset);
  } catch (e) {
    console.error(`[demo-admin] resend FAILED for ${asset.name}: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  const entry = list.find(a => normalizeEmail(a.email) === email) || null;
  if (!entry) {
    /* NDA-first: a person with only an nda_sent record gets the
       NDA email re-sent — there is no activation link to send
       until the NDA is executed and the asset provisions them. */
    if (invitesConfigured()) {
      let record = null;
      try {
        record = findInvite(await readInvites(), email, asset.id);
      } catch (e) {
        console.error(`[demo-admin] resend FAILED for ${asset.name}: ${e && e.message}`);
        return reply(res, 502, { ok: false, error: "store_failed" });
      }
      if (record) {
        const sent = await sendNdaEmail(asset, record.name, email);
        /* The attempt is stamped either way — counters bumped and
           the outcome recorded — so a failed resend is as visible
           on the matrix as a successful one. The stamp is
           best-effort: it never changes the send's own outcome. */
        try {
          await touchNdaInvite(email, asset.id, new Date(), sent);
        } catch (e) {
          console.error(`[demo-admin] NDA resend stamp FAILED for ${asset.name}: ${e && e.message} (email outcome: ${sent.sent ? "sent" : sent.reason}).`);
        }
        if (!sent.sent) {
          console.error(`[demo-admin] NDA resend FAILED for ${asset.name} (${sent.reason}).`);
          return reply(res, 200, {
            ok: true, emailed: false, state: "nda_sent",
            error: "email_failed", reason: sent.reason
          });
        }
        await emitOfficeEvent(asset, email, record.name, "nda_sent",
          "NDA invite re-sent from IEC Office");
        return reply(res, 200, {
          ok: true, emailed: true, resent: true,
          state: "nda_sent", kind: "nda", id: sent.id
        });
      }
    }
    return reply(res, 404, { ok: false, error: "not_found" });
  }
  const status = String(entry.status || "").toLowerCase();
  if (status !== "invited") {
    return reply(res, 200, { ok: true, emailed: false, state: status, reason: `status_${status}` });
  }
  if (!entry.token) {
    return reply(res, 200, { ok: true, emailed: false, state: "invited", reason: "no_token" });
  }
  const sent = await sendActivationEmail(asset, entry.name, email, entry.token);
  if (!sent.sent) {
    console.error(`[demo-admin] resend FAILED for ${asset.name} (${sent.reason}).`);
    return reply(res, 200, { ok: true, emailed: false, error: "email_failed", reason: sent.reason });
  }
  await emitOfficeEvent(asset, email, entry.name, "invite_sent",
    "Activation email re-sent from IEC Office");
  return reply(res, 200, { ok: true, emailed: true, resent: true, id: sent.id });
}

async function actionStatus(res, body) {
  const asset = gateAsset(res, body);
  if (!asset) return;
  const email = normalizeEmail(body.email);
  if (!plausibleEmail(email)) return reply(res, 400, { ok: false, error: "invalid_email" });
  const target = String(body.status || "").toLowerCase();
  if (target === "invited") {
    /* Access never moves backwards to invited — in particular a
       revoked account is never un-revoked into a live link. */
    return reply(res, 400, { ok: false, error: "status_transition_forbidden" });
  }
  if (!SETTABLE_STATUSES.includes(target)) {
    return reply(res, 400, { ok: false, error: "invalid_status" });
  }

  let outcome;
  try {
    outcome = await mutateStore(asset, (list, source) => {
      const entry = list.find(a => normalizeEmail(a.email) === email) || null;
      if (!entry) {
        const err = new Error("not_found");
        err.code = "not_found";
        throw err;
      }
      const previous = String(entry.status || "").toLowerCase();
      if (previous === target) return { result: { previous, changed: false, name: entry.name || "" } };
      return {
        write: setStatusInSource(source, email, target),
        message: `IEC Office: set ${email} on ${asset.name} to ${target}`,
        result: { previous, changed: true, name: entry.name || "" }
      };
    });
  } catch (e) {
    if (e && e.code === "not_found") return reply(res, 404, { ok: false, error: "not_found" });
    console.error(`[demo-admin] status FAILED for ${asset.name}: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  console.log(`[demo-admin] ${asset.name}: ${email} ${outcome.previous} -> ${target} (changed=${outcome.changed}).`);
  if (outcome.changed) {
    await emitOfficeEvent(asset, email, outcome.name || "", "status_changed",
      `${outcome.previous} → ${target} (via IEC Office)`);
  }
  return reply(res, 200, {
    ok: true,
    asset: asset.id,
    email,
    status: target,
    previousStatus: outcome.previous,
    changed: outcome.changed
  });
}

/* MARK NDA SIGNED (DrMorgan's order, 2026-11-12): the manual
   path for a paper-signed agreement. The signed state is
   recorded on the person's invite record for this ONE asset
   first — that record is the attestation (basis, signed date,
   operator) and it stands whatever happens next — then the
   demo is provisioned the way the asset-side signing trigger
   would have done it: a fresh "invited" entry in the asset's
   provisioning store plus the activation email. Provisioning
   can fail honestly (Office key unset → "not_configured";
   store unreadable/unwritable → "failed"): the response then
   reports state "nda_signed" with the provisioning outcome and
   reason, and the matrix cell shows NDA SIGNED — an access
   state is never claimed that the store does not hold. Keyed
   strictly to the one (email, asset) pair: no other record or
   entry is read for writing or modified. */
async function actionMarkNdaSigned(res, body, operator) {
  const asset = findAsset(body.asset);
  if (!asset) return reply(res, 400, { ok: false, error: "unknown_asset" });
  if (!asset.live) return reply(res, 400, { ok: false, error: "asset_not_live" });
  const email = normalizeEmail(body.email);
  if (!plausibleEmail(email)) return reply(res, 400, { ok: false, error: "invalid_email" });
  const name = String(body.name || "").trim().slice(0, 200);
  const basis = String(body.basis || "").trim().slice(0, 300) || "Paper agreement — verified by IEC";
  /* The date on the paper, YYYY-MM-DD. Defaults to today
     (America/New_York) when the caller does not supply one. */
  let signedDate = String(body.signedDate || "").trim();
  if (signedDate) {
    const m = signedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const real = m && !Number.isNaN(Date.parse(`${signedDate}T12:00:00Z`)) &&
      new Date(`${signedDate}T12:00:00Z`).getUTCDate() === Number(m[3]);
    if (!real) return reply(res, 400, { ok: false, error: "invalid_signed_date" });
  } else {
    signedDate = easternIso(new Date()).slice(0, 10);
  }

  if (!invitesConfigured()) {
    console.log("[demo-admin] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; a signed state cannot be recorded, so nothing was marked or provisioned.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }

  /* Where do things stand BEFORE the mark? The invite record
     (for the name and the already-signed check) and — when the
     asset's Office key is set — the provisioning entry. A store
     read failure is remembered, not fatal: the mark is recorded
     either way and provisioning reports the failure honestly. */
  let record = null;
  try {
    record = findInvite(await readInvites(), email, asset.id);
  } catch (e) {
    console.error(`[demo-admin] mark-nda-signed FAILED for ${asset.name}: invites read: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  const alreadySigned = !!record && String(record.status || "").toLowerCase() === "nda_signed";
  const entryName = name || (record && record.name) || "";
  const tokenConfigured = !!process.env[asset.tokenEnv];
  let entry = null;
  let storeReadFailed = false;
  if (tokenConfigured) {
    try {
      entry = (await readStore(asset)).find(a => normalizeEmail(a.email) === email) || null;
    } catch (e) {
      storeReadFailed = true;
      console.error(`[demo-admin] mark-nda-signed for ${asset.name}: provisioning store read FAILED: ${e && e.message}`);
    }
  }

  /* 1 — record the signed state. Record first, exactly like the
     invite path: if this write fails, nothing is provisioned on
     the strength of an unrecorded attestation. */
  try {
    await markNdaInviteSigned(email, asset.id, {
      name: entryName, basis, signedDate, markedBy: operator || "desk"
    });
  } catch (e) {
    console.error(`[demo-admin] mark-nda-signed record FAILED for ${asset.name}: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }

  /* 2 — provision, unless an entry already stands. The insert
     re-checks inside the mutation (a concurrent asset-side
     trigger may have landed first): whoever's write lands
     first, there is exactly one entry and at most one
     activation email from this action. */
  let provisioning = "already_provisioned";
  let provisionReason = null;
  let emailed = null;
  if (!entry) {
    if (!tokenConfigured) {
      provisioning = "not_configured";
      provisionReason = "asset_not_configured";
    } else if (storeReadFailed) {
      provisioning = "failed";
      provisionReason = "store_failed";
    } else {
      const token = crypto.randomBytes(24).toString("hex");
      try {
        const outcome = await mutateStore(asset, (list, source) => {
          const nowEntry = list.find(a => normalizeEmail(a.email) === email) || null;
          if (nowEntry) {
            return { result: { created: false, status: String(nowEntry.status || "invited").toLowerCase() } };
          }
          return {
            write: insertEntry(source, {
              email, name: entryName, token, status: "invited", issuedAt: easternIso(new Date())
            }),
            message: `IEC Office: invite ${email} to ${asset.name} demo (NDA marked signed — paper agreement)`,
            result: { created: true, status: "invited" }
          };
        });
        if (outcome.created) {
          provisioning = "provisioned";
          const sent = await sendActivationEmail(asset, entryName, email, token);
          emailed = sent.sent;
          if (!sent.sent) {
            provisionReason = sent.reason;
            console.error(`[demo-admin] ${asset.name} activation email FAILED for ${email} after mark-signed provisioning (${sent.reason}); the account stands — Resend re-sends the link.`);
          }
        } else {
          provisioning = "already_provisioned";
          entry = { status: outcome.status };
        }
      } catch (e) {
        provisioning = "failed";
        provisionReason = "store_failed";
        console.error(`[demo-admin] mark-nda-signed provisioning FAILED for ${asset.name}: ${e && e.message}`);
      }
    }
  }

  const state = entry
    ? String(entry.status || "invited").toLowerCase()
    : provisioning === "provisioned" ? "invited" : "nda_signed";
  await emitOfficeEvent(asset, email, entryName, "nda_signed",
    `NDA marked signed from IEC Office — ${basis} (signed ${signedDate}); provisioning: ${provisioning}${provisionReason ? ` (${provisionReason})` : ""}`);
  console.log(`[demo-admin] ${asset.name}: ${email} NDA marked signed (signed ${signedDate}, by ${operator || "desk"}); provisioning=${provisioning}, state=${state}.`);
  return reply(res, 200, {
    ok: true,
    asset: asset.id,
    email,
    ndaSigned: true,
    alreadySigned,
    state,
    signedDate,
    basis,
    markedBy: operator || "desk",
    provisioning,
    emailed,
    ...(provisionReason ? { reason: provisionReason } : {})
  });
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { ok: false, error: "method_not_allowed" });

  const session = getCookie(req.headers && req.headers.cookie, "desk_session");
  if (!session || !(await validSession(session))) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }
  /* The Desk operator's session user — stamped as markedBy on a
     manual mark-signed (the session was just verified above). */
  const operator = String(session).split(".")[0] || "desk";

  const body = await readBody(req);
  const action = String(body.action || "");
  if (action === "list") return actionList(res);
  if (action === "invite") return actionInvite(res, body);
  if (action === "resend") return actionResend(res, body);
  if (action === "status") return actionStatus(res, body);
  if (action === "mark-nda-signed") return actionMarkNdaSigned(res, body, operator);
  return reply(res, 400, { ok: false, error: "unknown_action" });
}

/* Exported for the local test suite (scripts/demo-admin.test.mjs);
   harmless in production. */
export const _internals = {
  ASSETS,
  parseProvisioning,
  insertEntry,
  setStatusInSource,
  buildMatrix,
  buildActivationEmail,
  buildNdaEmail,
  publicAccount,
  easternIso,
  normalizeEmail,
  validSession,
  acceptanceKeys,
  applyActivityAcceptance
};
