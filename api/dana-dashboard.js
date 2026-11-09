/* =====================================================================
   IEC Office — Dana Follow-Up dashboard API (DrMorgan's order
   2026-11-09: "House this in iec suite" — the Dana follow-up board
   becomes a native Desk module next to Dana — Opportunities).

   GET  /api/dana-dashboard
     → 200 { ok: true, configured, seeded, state }
       state is the saved board from the Office Blob store, or —
       when nothing has been saved yet (or after Reset) — the SEED
       board below, built from the target map of record
       (iec-employer-buyer-target-map-2026-11-06.md, refreshed by
       Dana's 2026-11-09 scout run, and the worldwide buyer board
       direct-data-buyers-worldwide-2026-11-09.md). seeded:true
       marks that case so the page can say so honestly.
   POST /api/dana-dashboard   (JSON body)
     { state: { decisions, buyers, runs } }
       → every entry is sanitized (unknown fields dropped, strings
         trimmed and length-capped, entries with no title/name
         dropped), stored, and answered 200 { ok: true, state }
         with the state as stored.
     { action: "reset" }
       → clears the saved board (the store keeps a JSON null) and
         answers 200 { ok: true, state } with the seed board.

   AUTH: the Desk session cookie, verified with exactly the scheme
   middleware.js / api/office-layout.js use (HMAC-SHA256 over
   "<user>.<exp>", DESK_SESSION_SECRET). No session → 401.

   STORAGE: one Blob document, dana-dashboard.json, via
   api/_dana-dashboard-store.js — the same Office Blob store as the
   Desk documents, NDA invites and demo activity, so the board
   follows DrMorgan across devices and browsers. When the store is
   not configured, GET answers the seed board with configured:false
   and POST answers 503 { error: "not_configured" } — a save is
   never faked.

   HARD RULES baked into the seed (standing, DrMorgan): no practice
   in the network is ever named to a buyer — the network is
   described, never identified — and IEC's fee split appears
   nowhere. Data is licensed, never sold.

   Env (this Vercel project — iecincglobal-site):
     DESK_SESSION_SECRET   (already set for the Desk)
     BLOB_READ_WRITE_TOKEN (already set for the Office)
   ===================================================================== */

import crypto from "node:crypto";
import { dashboardConfigured, readDashboard, writeDashboard } from "./_dana-dashboard-store.js";

/* ------------------------------------------------------------------ */
/* The seed board — the follow-up state of record as of Dana's       */
/* 2026-11-09 run and the same day's engagement round. Every fact     */
/* below is grounded in the two source files named in the header.     */
/* ------------------------------------------------------------------ */

const SEED_STATE = {
  decisions: [
    {
      id: "d-kai-entry",
      title: "Kai-entry correction — micro1",
      detail: "Dana's Nov 9 map entry says the micro1 Kai call completed on Nov 5. The standing record says no Kai call has happened, and a nudge asking Nikolo for a fresh scheduling link was sent Nov 9. The map entry needs your ruling: correct it back to “call never happened,” or check what Nikolo actually said first.",
      resolved: false,
      resolvedAt: null,
      createdAt: "2026-11-09"
    },
    {
      id: "d-pitch-batch",
      title: "Pitch-batch approval — six buyers + AlayaCare",
      detail: "First-contact pitches for Abridge, CodaMetrix, GSK, Pfizer, Novo Nordisk and J&J, plus the AlayaCare pitch email (its Nov 9 form inquiry carried no message field, so the pitch itself was never transmitted), are prepared for one approval. Nothing sends before your word.",
      resolved: false,
      resolvedAt: null,
      createdAt: "2026-11-09"
    },
    {
      id: "d-om1-nudge",
      title: "OM1 nudge — your word only",
      detail: "OM1 was submitted Nov 5 and has not replied (inbox checked Nov 9). Dana's recommendation: a nudge is due — but it goes only on your word, not before.",
      resolved: false,
      resolvedAt: null,
      createdAt: "2026-11-09"
    }
  ],
  buyers: [
    {
      id: "b-tempus", name: "Tempus", tier: "Tier 1",
      status: "Registered — acknowledged only",
      lastAction: "Submitted Nov 5, 2026; acknowledged the same day by partnerships@tempus.com (“a member of our team will follow up”) — no substantive reply since.",
      nextStep: "Answer any substantive follow-up within a day.",
      note: ""
    },
    {
      id: "b-om1", name: "OM1", tier: "Tier 1",
      status: "Registered — no reply",
      lastAction: "Submitted Nov 5, 2026; inbox searched Nov 9, 2026 — no OM1 reply found.",
      nextStep: "Nudge only on DrMorgan's word (see the decisions queue).",
      note: ""
    },
    {
      id: "b-astrazeneca", name: "AstraZeneca", tier: "Tier 1",
      status: "Proposal submitted — Nov 9",
      lastAction: "Open Innovation Proposal 8812 submitted Nov 9, 2026 under Target Identification & Validation (oncology real-world data concept; non-confidential step).",
      nextStep: "Watch the portal and inbox for the reviewer response.",
      note: ""
    },
    {
      id: "b-atropos", name: "Atropos Health", tier: "Tier 1",
      status: "Submitted — Nov 9",
      lastAction: "Evidence Network data-partner inquiry submitted Nov 9, 2026 (clinical notes are a stated network input).",
      nextStep: "Watch for a reply.",
      note: ""
    },
    {
      id: "b-alayacare", name: "AlayaCare", tier: "Tier 1",
      status: "Inquiry submitted — pitch not transmitted",
      lastAction: "AlayaSphere contact-form inquiry submitted Nov 9, 2026 — the form had no message field, so the pitch itself was NOT transmitted. CSP template agreement located, not signed.",
      nextStep: "Pitch email sits in the approval batch (see the decisions queue).",
      note: ""
    },
    {
      id: "b-micro1", name: "micro1", tier: "Tier 2",
      status: "Live engagement",
      lastAction: "Nudge sent Nov 9, 2026 to Nikolo asking for a fresh Kai scheduling link. The Data Information Form is fully mapped with a provisional fill — NOT submitted.",
      nextStep: "DrMorgan takes the Kai call when a new link lands; the form submits only on his word.",
      note: ""
    },
    {
      id: "b-openai", name: "OpenAI", tier: "Tier 2",
      status: "Submitted — Nov 9",
      lastAction: "Data Partnerships interest submitted Nov 9, 2026 (private datasets only; bilingual clinical documentation and annotations; volumes in writing under NDA).",
      nextStep: "Watch for a reply; full inventory follows in writing under NDA.",
      note: ""
    },
    {
      id: "b-onemednet", name: "OneMedNet", tier: "Tier 3",
      status: "New — relationship approach only",
      lastAction: "Added by Dana's Nov 9, 2026 run: multimodal clinical data licensed to life sciences, medtech and AI developers; 2,300+ healthcare partner sites; no public self-serve provider intake verified.",
      nextStep: "Relationship approach only, after the medical end-buyers, once the metadata inventory exists.",
      note: ""
    },
    {
      id: "b-gradient", name: "Gradient Health", tier: "Tier 3",
      status: "Deprioritized — registered Nov 6",
      lastAction: "Registered Nov 6, 2026. Deprioritized tier (dataset company), NOT parked. Door re-verified Nov 9: live; they typically seek partners able to contribute 1M+ datasets — a scale test for the network inventory.",
      nextStep: "File after the medical end-buyers; the inventory must prove scale first.",
      note: ""
    },
    {
      id: "b-segmed", name: "Segmed", tier: "Tier 3",
      status: "Deprioritized — registered Nov 6",
      lastAction: "Registered Nov 6, 2026. Deprioritized tier (dataset company), NOT parked. Door re-verified Nov 9: live; 2,800+ partner sites, 150M+ imaging studies.",
      nextStep: "File after the medical end-buyers; the conversation turns on imaging volume by specialty.",
      note: ""
    },
    {
      id: "b-experian", name: "Experian", tier: "Tier 4",
      status: "Inquiry submitted — paid route unproven",
      lastAction: "Partner inquiry submitted Nov 9, 2026 asking whether a paid licensing route exists. Its published Commercial Data Contribution program is a reciprocal in-kind swap (contributed payment data for database access) — no paid route is published.",
      nextStep: "Treat as a Tier-4 question mark, not a buyer, unless a paid route is evidenced.",
      note: ""
    },
    {
      id: "b-hippocratic", name: "Hippocratic AI", tier: "Part A — Employers",
      status: "Employer door — live hiring",
      lastAction: "Re-verified Nov 9, 2026: the RN/NP Clinical Quality Reviewer contract posting is still open, plus an RN Clinical Data Annotation Specialist role; a Supervising Nurse (Arabic/Hebrew) role also posts — Arabic-language supervision in their model strengthens the EN/AR angle.",
      nextStep: "Fastest Part A path: answer the live reviewer demand as the on-ramp; put the governed bilingual pod offer in front of their clinical team.",
      note: ""
    },
    {
      id: "b-peercheck", name: "Doximity — PeerCheck", tier: "Part A — Employers",
      status: "Employer door — open seat",
      lastAction: "Re-verified Nov 9, 2026, unchanged: PeerCheck runs 12,000+ physician reviewers inside Doximity Ask and is actively recruiting reviewers; a group/vendor supply route was not verified.",
      nextStep: "IEC physicians join as reviewers through the open door; pitch the editorial team a specialty pod plus Spanish-language and bias review.",
      note: ""
    },
    {
      id: "b-datasupply", name: "DataSupply / Troy Hyde", tier: "Channel",
      status: "Bounded bridge channel — internal only",
      lastAction: "Channel terms under negotiation on DrMorgan's word (Nov 8 ruling, bounded). Negotiation points ready (12 points incl. evergreen client protection); the negotiation email draft is written but UNSENT, awaiting his approval and mailbox choice.",
      nextStep: "DrMorgan negotiates himself; nothing goes in writing first.",
      note: "Internal only — the bridge framing is never disclosed to the counterparty."
    },
    {
      id: "b-aribase", name: "Aribase", tier: "Out",
      status: "OUT — broker rule",
      lastAction: "Ruled OUT Nov 6, 2026 (broker; DrMorgan: direct data buyers only). A submission made Nov 5, before the ruling, was acknowledged; the promised assessment never arrived and is moot under the ruling.",
      nextStep: "No further action.",
      note: ""
    },
    {
      id: "b-protege", name: "Protege", tier: "Out",
      status: "OUT — marketplace rule",
      lastAction: "Ruled OUT Nov 6, 2026 (marketplace). Registration was not pursued.",
      nextStep: "No further action.",
      note: ""
    }
  ],
  runs: [
    {
      id: "r-2026-11-09",
      date: "2026-11-09",
      summary: "Manual scout run on DrMorgan's top-priority order, ahead of the Wednesday cadence. Target map refreshed in place; mail record read from the actual messages.",
      changes: "OneMedNet added as a new Tier 3 buyer. OM1: no reply. Tempus: acknowledged only. Aribase + Protege marked OUT under the broker/marketplace rule. Hippocratic AI, Doximity PeerCheck, Segmed, Gradient Health, HealthVerity and the OpenAI Data Partnerships page re-verified live. IONOS mail checked — no new replies on the in-motion doors."
    }
  ]
};

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
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Sanitizers — the board is DrMorgan's data; anything stored goes   */
/* through here so a hand-edited or stale document can never inject  */
/* markup-sized strings or unknown shapes into the page.             */
/* ------------------------------------------------------------------ */

const str = (v, max) => String(v ?? "").trim().slice(0, max);
const validId = v => {
  const id = String(v ?? "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
};

function sanitizeDecision(d, i) {
  if (!d || typeof d !== "object") return null;
  const title = str(d.title, 200);
  if (!title) return null;
  return {
    id: validId(d.id) || `d-${i + 1}`,
    title,
    detail: str(d.detail, 2000),
    resolved: d.resolved === true,
    resolvedAt: d.resolved === true ? (str(d.resolvedAt, 40) || null) : null,
    createdAt: str(d.createdAt, 40)
  };
}

function sanitizeBuyer(b, i) {
  if (!b || typeof b !== "object") return null;
  const name = str(b.name, 120);
  if (!name) return null;
  return {
    id: validId(b.id) || `b-${i + 1}`,
    name,
    tier: str(b.tier, 60) || "Tier 3",
    status: str(b.status, 200),
    lastAction: str(b.lastAction, 2000),
    nextStep: str(b.nextStep, 2000),
    note: str(b.note, 2000)
  };
}

function sanitizeRun(r, i) {
  if (!r || typeof r !== "object") return null;
  const summary = str(r.summary, 2000);
  const changes = str(r.changes, 4000);
  if (!summary && !changes) return null;
  return {
    id: validId(r.id) || `r-${i + 1}`,
    date: str(r.date, 40),
    summary,
    changes
  };
}

function sanitizeList(value, fn, cap) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  value.forEach((entry, i) => {
    if (out.length >= cap) return;
    const clean = fn(entry, i);
    if (!clean || seen.has(clean.id)) return;
    seen.add(clean.id);
    out.push(clean);
  });
  return out;
}

/* A complete, storable board from any input (request body, stored
   document, or the seed). */
function sanitizeState(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    decisions: sanitizeList(src.decisions, sanitizeDecision, 200),
    buyers: sanitizeList(src.buyers, sanitizeBuyer, 500),
    runs: sanitizeList(src.runs, sanitizeRun, 500),
    updatedAt: new Date().toISOString()
  };
}

/* A stored document goes back out through the same sanitizer. A
   document that sanitizes to three empty lists is treated as "no
   saved board" — the seed is more useful than an empty page. */
function publicState(stored) {
  if (!stored || typeof stored !== "object") return null;
  const clean = sanitizeState(stored);
  if (!clean.decisions.length && !clean.buyers.length && !clean.runs.length) return null;
  return clean;
}

function seedState() {
  return sanitizeState(JSON.parse(JSON.stringify(SEED_STATE)));
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  const cookie = getCookie(req.headers && req.headers.cookie, "desk_session");
  if (!cookie || !(await validSession(cookie))) {
    return reply(res, 401, { ok: false, error: "unauthorized" });
  }

  const method = String(req.method || "GET").toUpperCase();

  if (method === "GET") {
    if (!dashboardConfigured()) {
      return reply(res, 200, { ok: true, configured: false, seeded: true, state: seedState() });
    }
    try {
      const saved = publicState(await readDashboard());
      if (saved) return reply(res, 200, { ok: true, configured: true, seeded: false, state: saved });
      return reply(res, 200, { ok: true, configured: true, seeded: true, state: seedState() });
    } catch (e) {
      console.error(`[dana-dashboard] read FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  if (method === "POST") {
    if (!dashboardConfigured()) {
      console.log("[dana-dashboard] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; the board cannot be saved.");
      return reply(res, 503, { ok: false, error: "not_configured" });
    }
    const body = await readBody(req);
    try {
      if (body && body.action === "reset") {
        await writeDashboard(null);
        return reply(res, 200, { ok: true, state: seedState() });
      }
      const state = sanitizeState(body && body.state ? body.state : body);
      await writeDashboard(state);
      return reply(res, 200, { ok: true, state });
    } catch (e) {
      console.error(`[dana-dashboard] save FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  return reply(res, 405, { ok: false, error: "method_not_allowed" });
}

/* Exposed for the local test suite only. */
export const _internals = { SEED_STATE, sanitizeState, sanitizeDecision, sanitizeBuyer, sanitizeRun, seedState };
