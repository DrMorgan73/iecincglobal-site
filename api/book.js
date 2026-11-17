/* =====================================================================
   IEC — "Book a call with Dr. Mohammed Morgan" endpoint.

   GET /api/book
     → { ok, timezone, slotMinutes, days: [ { date, slots:
         [ { time, startUtc } ] } ] } — public availability only:
     dates and times, never any booking detail. Booked slots are
     excluded (they are simply not offered).

   GET /api/book?id=<booking id>
     → { ok, found, date?, time? } — existence check only; no
     booking content is ever returned. Used to confirm a booking
     landed (e.g. after a test booking).

   POST /api/book   (JSON body, public)
     { name, email, company, note, date: "YYYY-MM-DD",
       time: "HH:MM", company_website: "" (honeypot) }
     Books the slot: the endpoint re-validates the slot against
     the availability rules (api/_booking-config.js), re-reads
     the store and refuses a slot that was just taken (409
     slot_taken), appends the booking to bookings.json in the
     Office Blob store (api/_booking-store.js), and emails the
     booking details to info@iecincglobal.com via Resend.

   POST /api/book   { action: "cancel", id, email }
     Self-service cancel: removes the booking when the email
     matches the booker's. Frees the slot immediately.

   AVAILABILITY RULES live in ONE place: api/_booking-config.js
   (Mon–Fri, 9:00 AM–5:00 PM America/New_York, 30-minute slots,
   2 hours' minimum notice, 14 days ahead).

   The Blob store is REQUIRED here (unlike the questionnaire's
   email fallback): without it there is no double-booking
   protection, so the endpoint fails closed with 503
   not_configured rather than taking bookings it cannot track.

   SANITY: bodies over 32 KB are rejected (413); every string is
   length-capped; a filled honeypot is refused with a generic
   400. No sessions, no cookies — this is a public intake.

   Env (this Vercel project — iecincglobal-site):
     BLOB_READ_WRITE_TOKEN       Office Blob store
     DEMO_ADMIN_RESEND_API_KEY   Resend sending key (the same key
                                 questionnaire-submit uses)
   ===================================================================== */

import crypto from "node:crypto";
import { BOOKING_CONFIG } from "./_booking-config.js";
import {
  generateSlots,
  isOfferedSlot,
  zonedTimeToUtc,
  describeSlot
} from "./_booking-slots.js";
import {
  bookingsConfigured,
  readBookings,
  tryAppendBooking,
  findBooking,
  removeBooking
} from "./_booking-store.js";

const NOTIFY_TO = "info@iecincglobal.com";
/* Sender on IEC's own domain (verified in Resend) — same sender
   the questionnaire notifications use. BOOKING_MAIL_FROM
   overrides it without a code change. */
const MAIL_FROM = process.env.BOOKING_MAIL_FROM || "IEC Booking <notifications@iecincglobal.com>";
const MAX_BODY_BYTES = 32 * 1024;

/* IEC org signature — same shape as questionnaire-submit's
   (logo, org line, no personal name). */
const SIGNATURE_TEXT = [
  "IEC, Inc.",
  "857-867-1767",
  "info@iecincglobal.com"
].join("\n");

const SIGNATURE_HTML = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px">',
  '<tr><td><img src="https://iecincglobal.com/assets/iec-logo-email.png" width="140" alt="IEC, Inc." style="display:block;border:0"></td></tr>',
  '<tr><td style="padding-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1A1A1A">',
  "<strong>IEC, Inc.</strong><br>",
  '<a href="tel:+18578671767" style="color:#1A1A1A;text-decoration:none">857-867-1767</a><br>',
  '<a href="mailto:info@iecincglobal.com" style="color:#1A1A1A;text-decoration:none">info@iecincglobal.com</a>',
  "</td></tr>",
  "</table>"
].join("");

/* ------------------------------------------------------------------ */
/* Small helpers (mirroring api/questionnaire-submit.js)               */
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

function cap(s, n) {
  return String(s == null ? "" : s).slice(0, n);
}

function reply(res, code, obj) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(code).json(obj);
  }
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

/* Read the RAW body with a hard byte cap — oversized payloads are
   rejected before any parsing. Resolves null when over the cap. */
function readRawBody(req, capBytes) {
  if (typeof req.body === "string") {
    return Promise.resolve(Buffer.byteLength(req.body, "utf8") > capBytes ? null : req.body);
  }
  if (req.body && typeof req.body === "object") {
    const s = JSON.stringify(req.body);
    return Promise.resolve(Buffer.byteLength(s, "utf8") > capBytes ? null : s);
  }
  return new Promise(resolve => {
    let data = "";
    let size = 0;
    let over = false;
    if (typeof req.on !== "function") return resolve("");
    req.on("data", c => {
      size += c.length;
      if (size > capBytes) { over = true; return; }
      data += c;
    });
    req.on("end", () => resolve(over ? null : data));
    req.on("error", () => resolve(""));
  });
}

/* ------------------------------------------------------------------ */
/* Notification email — mirrors questionnaire-submit's Resend sends    */
/* ------------------------------------------------------------------ */

function buildNotification(record) {
  const when = describeSlot(record.startUtc);
  const lines = [
    "New call booking — Book a call with Dr. Mohammed Morgan.",
    "",
    `When: ${when} (${BOOKING_CONFIG.slotMinutes} minutes)`,
    `Booking ID: ${record.id}`,
    `Booked at: ${record.receivedAt}`,
    "",
    "Booker:",
    `  Name: ${record.name}`,
    `  Email: ${record.email}`,
    `  Company: ${record.company || "—"}`,
    `  Note: ${record.note || "—"}`,
    "",
    "Next step: confirm the booking with the booker by email.",
    "",
    SIGNATURE_TEXT
  ];
  const html = [
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">New call booking — <strong>Book a call with Dr. Mohammed Morgan</strong>.</p>`,
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><strong>When:</strong> ${escapeHtml(when)} (${BOOKING_CONFIG.slotMinutes} minutes)<br>` +
      `<span style="font-size:13px;color:#5a6b7d">Booking ID: ${escapeHtml(record.id)}<br>Booked at: ${escapeHtml(record.receivedAt)}</span></p>`,
    `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px"><strong>Booker</strong><br>` +
      `Name: ${escapeHtml(record.name)}<br>` +
      `Email: <a href="mailto:${escapeHtml(record.email)}">${escapeHtml(record.email)}</a><br>` +
      `Company: ${escapeHtml(record.company || "—")}<br>` +
      `Note: ${escapeHtml(record.note || "—")}</p>`,
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5a6b7d">Next step: confirm the booking with the booker by email.</p>',
    SIGNATURE_HTML
  ].join("\n");
  return {
    subject: `New booking — ${when} — ${record.name}`,
    text: lines.join("\n"),
    html
  };
}

/* { sent:true, id } | { sent:false, reason } — never throws. */
async function sendNotification(record) {
  const key = process.env.DEMO_ADMIN_RESEND_API_KEY || "";
  if (!key) return { sent: false, reason: "not_configured" };
  const mail = buildNotification(record);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [NOTIFY_TO],
        reply_to: record.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { sent: false, reason: `resend_${r.status}` };
    return { sent: true, id: data.id || null };
  } catch (e) {
    return { sent: false, reason: "send_failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method === "GET") {
    const url = new URL(req.url, "https://iecincglobal.com");
    if (!bookingsConfigured()) {
      return reply(res, 503, { ok: false, error: "not_configured" });
    }

    /* Existence check for a known booking id (verification only —
       returns no content beyond the booked date/time). */
    const id = String(url.searchParams.get("id") || "");
    if (id) {
      if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) {
        return reply(res, 400, { ok: false, error: "invalid_id" });
      }
      try {
        const found = await findBooking(id);
        return reply(res, 200, {
          ok: true,
          found: !!found,
          ...(found ? { date: found.date, time: found.time } : {})
        });
      } catch (e) {
        console.error(`[book] check FAILED: ${e && e.message}`);
        return reply(res, 502, { ok: false, error: "store_failed" });
      }
    }

    /* Public availability: offered slots grouped by date. */
    try {
      const bookings = await readBookings();
      const slots = generateSlots(new Date(), bookings);
      const days = [];
      for (const s of slots) {
        let day = days[days.length - 1];
        if (!day || day.date !== s.date) {
          day = { date: s.date, slots: [] };
          days.push(day);
        }
        day.slots.push({ time: s.time, startUtc: s.startUtc });
      }
      return reply(res, 200, {
        ok: true,
        timezone: BOOKING_CONFIG.timezone,
        slotMinutes: BOOKING_CONFIG.slotMinutes,
        days
      });
    } catch (e) {
      console.error(`[book] availability FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  if (req.method !== "POST") {
    return reply(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const raw = await readRawBody(req, MAX_BODY_BYTES);
  if (raw === null) {
    return reply(res, 413, { ok: false, error: "payload_too_large" });
  }
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch (e) {
    return reply(res, 400, { ok: false, error: "invalid_json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply(res, 400, { ok: false, error: "invalid_body" });
  }

  if (!bookingsConfigured()) {
    console.log("[book] NO-OP — BLOB_READ_WRITE_TOKEN is not configured; no booking can be tracked, so none is taken.");
    return reply(res, 503, { ok: false, error: "not_configured" });
  }

  /* Self-service cancel: booking id + the booker's own email. */
  if (body.action === "cancel") {
    const id = String(body.id || "");
    const email = normalizeEmail(body.email);
    if (!/^[A-Za-z0-9-]{8,80}$/.test(id) || !plausibleEmail(email)) {
      return reply(res, 400, { ok: false, error: "invalid_cancel" });
    }
    try {
      const removed = await removeBooking(id, email);
      if (!removed) {
        return reply(res, 404, { ok: false, error: "not_found" });
      }
      console.log(`[book] booking ${id} cancelled by booker.`);
      return reply(res, 200, { ok: true, removed: true, id });
    } catch (e) {
      console.error(`[book] cancel FAILED: ${e && e.message}`);
      return reply(res, 502, { ok: false, error: "store_failed" });
    }
  }

  /* Honeypot: a real visitor never sees this field. */
  if (cap(body.company_website, 10).trim()) {
    return reply(res, 400, { ok: false, error: "rejected" });
  }

  const name = cap(body.name, 200).trim();
  const email = normalizeEmail(body.email);
  const company = cap(body.company, 200).trim();
  const note = cap(body.note, 1000).trim();
  const date = String(body.date || "");
  const time = String(body.time || "");
  if (!name) return reply(res, 400, { ok: false, error: "name_required" });
  if (!plausibleEmail(email)) return reply(res, 400, { ok: false, error: "invalid_email" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return reply(res, 400, { ok: false, error: "invalid_slot" });
  }

  /* Re-validate the slot against the rules as of right now —
     never trust the page's view of availability. */
  if (!isOfferedSlot(date, time)) {
    return reply(res, 400, { ok: false, error: "slot_unavailable" });
  }

  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const record = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    receivedAt: new Date().toISOString(),
    date,
    time,
    startUtc: zonedTimeToUtc(y, mo, d, hh, mm).toISOString(),
    timezone: BOOKING_CONFIG.timezone,
    name,
    email,
    company,
    note,
    status: "booked"
  };

  /* Store FIRST (with the fresh re-read + conflict check inside
     tryAppendBooking), notify second: a booking that cannot be
     stored is never announced. */
  let result;
  try {
    result = await tryAppendBooking(record);
  } catch (e) {
    console.error(`[book] store FAILED: ${e && e.message}`);
    return reply(res, 502, { ok: false, error: "store_failed" });
  }
  if (!result.ok) {
    return reply(res, 409, {
      ok: false,
      error: "slot_taken",
      message: "That time was just taken — please pick another slot."
    });
  }

  const sent = await sendNotification(record);
  if (!sent.sent && sent.reason !== "not_configured") {
    console.error(`[book] notification email FAILED (${sent.reason}) for booking ${record.id}.`);
  }
  console.log(`[book] booking ${record.id} (${date} ${time} ${BOOKING_CONFIG.timezone}) stored=true emailed=${sent.sent}.`);
  return reply(res, 200, {
    ok: true,
    id: record.id,
    date: record.date,
    time: record.time,
    startUtc: record.startUtc,
    emailed: sent.sent
  });
}
