/* Local test suite for api/_booking-handler.js (hosted by
   api/questionnaire-submit.js behind the /api/book rewrite —
   see that handler's header for why) + api/_booking-store.js +
   api/_booking-slots.js + api/_booking-config.js (IEC — "Book a
   call with Dr. Mohammed Morgan", book.html).

   @vercel/blob is redirected to an in-memory mock (scripts/testing/)
   via module hooks; fetch is mocked for Resend and the Blob URLs.
   No real Blob store, no real emails.

   Covers: DST-safe America/New_York slot math (EST/EDT offsets,
   spring-forward and fall-back days), weekend exclusion, past and
   minimum-notice exclusion, booked-slot exclusion, availability
   grouping, booking + notification, double-booking refusal (409),
   rule re-validation server-side, validation + honeypot, the
   existence check, self-service cancel (wrong email refused,
   right email frees the slot), and the unconfigured fail-closed
   answer.

   Run: node scripts/book.test.mjs   (exit 1 on any failure) */

import { register } from "node:module";

register("./testing/blob-hooks.mjs", import.meta.url);

const blobMock = await import("./testing/blob-mock.mjs");
const { __blobs } = blobMock;

/* ---------------- env ---------------- */
process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
process.env.DEMO_ADMIN_RESEND_API_KEY = "test-resend-key";
delete process.env.BOOKING_MAIL_FROM;

/* ---------------- mocked fetch (Resend + Blob URLs) ---------------- */
const sentEmails = [];
const blobFetchUrls = [];

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
  if (u === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(opts.body));
    return jsonRes(200, { id: `email-${sentEmails.length}` });
  }
  if (u.startsWith("https://blob.mock/")) {
    blobFetchUrls.push(u);
    /* The real Blob CDN keys objects by path and ignores the
       query string (the store's cache-buster) — match likewise. */
    const pathOnly = u.split("?")[0];
    for (const rec of __blobs.values()) {
      if (rec.url === pathOnly) return textRes(200, rec.content);
    }
    return textRes(404, "");
  }
  throw new Error(`unmocked fetch: ${u}`);
};

/* ---------------- modules under test ---------------- */
const handler = (await import("../api/_booking-handler.js")).bookingHandler;
const hostHandler = (await import("../api/questionnaire-submit.js")).default;
const slots = await import("../api/_booking-slots.js");
const store = await import("../api/_booking-store.js");

async function callHost(method, { url = "/api/questionnaire-submit", body } = {}) {
  const req = { method, url, headers: {}, body };
  const res = {
    statusCode: 0,
    payload: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    setHeader() {},
    end(s) { this.payload = JSON.parse(s); }
  };
  await hostHandler(req, res);
  return { status: res.statusCode, body: res.payload };
}

async function call(method, { url = "/api/book", body } = {}) {
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
  sentEmails.length = 0;
  blobFetchUrls.length = 0;
}

/* ---------------- tiny assert kit ---------------- */
let failures = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  ok — ${label}`);
  } else {
    failures++;
    console.log(`  FAIL — ${label} ${extra}`);
  }
}

/* ================= slot mathematics ================= */
console.log("slot math — DST-safe America/New_York conversion");
{
  const summer = slots.zonedTimeToUtc(2026, 7, 1, 9, 0).toISOString();
  check("Jul 1 9:00 AM ET = 13:00 UTC (EDT)", summer === "2026-07-01T13:00:00.000Z", summer);
  const winter = slots.zonedTimeToUtc(2026, 1, 15, 9, 0).toISOString();
  check("Jan 15 9:00 AM ET = 14:00 UTC (EST)", winter === "2026-01-15T14:00:00.000Z", winter);
  const spring = slots.zonedTimeToUtc(2027, 3, 14, 9, 0).toISOString();
  check("Mar 14 2027 (spring forward) 9:00 AM ET = 13:00 UTC", spring === "2027-03-14T13:00:00.000Z", spring);
  const fall = slots.zonedTimeToUtc(2026, 11, 1, 9, 0).toISOString();
  check("Nov 1 2026 (fall back) 9:00 AM ET = 14:00 UTC", fall === "2026-11-01T14:00:00.000Z", fall);
  const evening = slots.zonedTimeToUtc(2026, 11, 18, 16, 30).toISOString();
  check("Nov 18 4:30 PM ET = 21:30 UTC", evening === "2026-11-18T21:30:00.000Z", evening);
}

console.log("slot math — generation rules (fixed now: Wed Nov 18 2026, 10:00 AM EST)");
{
  const now = new Date("2026-11-18T15:00:00.000Z"); // 10:00 AM EST
  const all = slots.generateSlots(now, []);
  check("slots generated", all.length > 0, `n=${all.length}`);
  check("no Saturday slots (Nov 21)", !all.some(s => s.date === "2026-11-21"));
  check("no Sunday slots (Nov 22)", !all.some(s => s.date === "2026-11-22"));
  check("all starts within 9:00–16:30", all.every(s => s.time >= "09:00" && s.time <= "16:30"));
  const today = all.filter(s => s.date === "2026-11-18");
  check("minimum notice: first slot today is 12:00 PM (now 10 AM + 2h)",
    today.length > 0 && today[0].time === "12:00", today[0] && today[0].time);
  check("no slot starts before now + 2h",
    all.every(s => new Date(s.startUtc).getTime() >= now.getTime() + 2 * 3600 * 1000));
  const dates = [...new Set(all.map(s => s.date))];
  check("14-day horizon: last offered date is Tue Dec 1 2026",
    dates[dates.length - 1] === "2026-12-01", dates[dates.length - 1]);
  check("10 bookable weekdays in the window", dates.length === 10, `days=${dates.length}`);
  const booked = [{ date: "2026-11-19", time: "09:00" }];
  const minus = slots.generateSlots(now, booked);
  check("booked slot excluded",
    !minus.some(s => s.date === "2026-11-19" && s.time === "09:00") &&
    minus.length === all.length - 1);
  check("isOfferedSlot accepts a real slot", slots.isOfferedSlot("2026-11-19", "09:30", now));
  check("isOfferedSlot refuses a weekend", !slots.isOfferedSlot("2026-11-21", "10:00", now));
  check("isOfferedSlot refuses outside hours", !slots.isOfferedSlot("2026-11-19", "17:00", now));
  check("isOfferedSlot refuses inside the notice window", !slots.isOfferedSlot("2026-11-18", "11:30", now));
  check("isOfferedSlot refuses beyond the horizon", !slots.isOfferedSlot("2026-12-02", "10:00", now));
}

/* ================= handler flow ================= */
console.log("handler — availability, booking, double-booking, cancel");
{
  resetAll();

  const avail = await call("GET", {});
  check("GET availability 200", avail.status === 200 && avail.body.ok === true, JSON.stringify(avail.body));
  check("availability carries timezone + length",
    avail.body.timezone === "America/New_York" && avail.body.slotMinutes === 30);
  check("availability grouped by day with slots",
    Array.isArray(avail.body.days) && avail.body.days.length > 0 &&
    avail.body.days[0].slots.length > 0 && !!avail.body.days[0].slots[0].startUtc);
  check("availability leaks no booking detail",
    !JSON.stringify(avail.body).includes("@") );

  const day = avail.body.days[0];
  const slot = day.slots[0];
  const booking = {
    name: "Test Booker",
    email: "booker@example.com",
    company: "Example Co",
    note: "Intro call",
    date: day.date,
    time: slot.time,
    company_website: ""
  };

  const bad1 = await call("POST", { body: { ...booking, email: "not-an-email" } });
  check("invalid email refused 400", bad1.status === 400 && bad1.body.error === "invalid_email");
  const bad2 = await call("POST", { body: { ...booking, name: " " } });
  check("missing name refused 400", bad2.status === 400 && bad2.body.error === "name_required");
  const bad3 = await call("POST", { body: { ...booking, company_website: "http://spam.example" } });
  check("filled honeypot refused 400", bad3.status === 400 && bad3.body.error === "rejected");
  const bad4 = await call("POST", { body: { ...booking, date: "2026-11-21", time: "10:00" } });
  check("Saturday slot refused 400 slot_unavailable",
    bad4.status === 400 && bad4.body.error === "slot_unavailable", JSON.stringify(bad4.body));

  const made = await call("POST", { body: booking });
  check("booking succeeds 200", made.status === 200 && made.body.ok === true, JSON.stringify(made.body));
  check("booking reports emailed=true", made.body.emailed === true);
  check("notification sent once, to info@iecincglobal.com",
    sentEmails.length === 1 && sentEmails[0].to.includes("info@iecincglobal.com"));
  check("notification from notifications@iecincglobal.com",
    String(sentEmails[0].from).includes("notifications@iecincglobal.com"));
  check("notification subject names the booking",
    sentEmails[0].subject.includes("New booking") && sentEmails[0].subject.includes("Test Booker"));
  check("notification reply-to is the booker", sentEmails[0].reply_to === "booker@example.com");

  const stored = await store.readBookings();
  check("booking stored in bookings.json", stored.length === 1 && stored[0].id === made.body.id);
  check("store reads carry the cache-busting query (live CDN serves 30-day cache headers)",
    blobFetchUrls.length > 0 && blobFetchUrls.every(u => u.includes("?v=")),
    blobFetchUrls[0] || "no blob fetch recorded");

  const avail2 = await call("GET", {});
  const day2 = avail2.body.days.find(d => d.date === day.date);
  check("booked slot no longer offered",
    !day2 || !day2.slots.some(s => s.time === slot.time));

  const dupe = await call("POST", { body: { ...booking, name: "Second Person", email: "second@example.com" } });
  check("double-booking refused 409 slot_taken",
    dupe.status === 409 && dupe.body.error === "slot_taken", JSON.stringify(dupe.body));
  check("double-booking stored nothing new", (await store.readBookings()).length === 1);
  check("double-booking sent no second email", sentEmails.length === 1);

  const found = await call("GET", { url: `/api/book?id=${made.body.id}` });
  check("existence check finds the booking",
    found.status === 200 && found.body.found === true && found.body.date === day.date);
  const missing = await call("GET", { url: "/api/book?id=zzzzzzzz-nonexistent" });
  check("existence check reports a miss cleanly",
    missing.status === 200 && missing.body.found === false);

  const wrongCancel = await call("POST", { body: { action: "cancel", id: made.body.id, email: "someone-else@example.com" } });
  check("cancel with the wrong email refused 404",
    wrongCancel.status === 404 && (await store.readBookings()).length === 1);
  const cancelled = await call("POST", { body: { action: "cancel", id: made.body.id, email: "BOOKER@example.com" } });
  check("cancel with the booker's email succeeds (case-insensitive)",
    cancelled.status === 200 && cancelled.body.removed === true);
  check("store empty after cancel", (await store.readBookings()).length === 0);
  const rebooked = await call("POST", { body: booking });
  check("freed slot can be booked again", rebooked.status === 200 && rebooked.body.ok === true);
}

console.log("host dispatch — /api/book arrives as questionnaire-submit?channel=book");
{
  resetAll();
  const viaHost = await callHost("GET", { url: "/api/questionnaire-submit?channel=book" });
  check("channel=book reaches the booking handler (availability shape)",
    viaHost.status === 200 && viaHost.body.ok === true && Array.isArray(viaHost.body.days),
    JSON.stringify(viaHost.body).slice(0, 120));
  const plain = await callHost("POST", { body: { contact: { name: "Q", email: "q@example.com" } } });
  check("no channel parameter = questionnaire traffic (unknown_segment)",
    plain.status === 400 && plain.body.error === "unknown_segment", JSON.stringify(plain.body));
  const plainGet = await callHost("GET", { url: "/api/questionnaire-submit?id=abcd1234-test" });
  check("questionnaire existence check still answers on the host",
    plainGet.status === 200 && plainGet.body.ok === true && plainGet.body.found === false,
    JSON.stringify(plainGet.body));
}

console.log("handler — unconfigured store fails closed");
{
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const r = await call("GET", {});
  check("GET without Blob token answers 503 not_configured",
    r.status === 503 && r.body.error === "not_configured");
  const p = await call("POST", { body: { name: "X", email: "x@example.com", date: "2026-11-19", time: "10:00" } });
  check("POST without Blob token answers 503 not_configured",
    p.status === 503 && p.body.error === "not_configured");
  process.env.BLOB_READ_WRITE_TOKEN = saved;
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
