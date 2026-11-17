/* =====================================================================
   IEC — "Book a call" slot mathematics (pure functions; shared
   helper, the leading underscore keeps Vercel from routing it).

   All availability rules live in api/_booking-config.js. This
   module turns them into concrete slots. Every wall-clock time is
   in the configured timezone (America/New_York): the conversion to
   a UTC instant goes through Intl with that zone and resolves the
   zone offset iteratively, so slots stay at 9:00 AM–5:00 PM local
   across DST changes (EST ↔ EDT) instead of drifting an hour.

   A slot is { date: "YYYY-MM-DD", time: "HH:MM", startUtc: ISO } —
   date/time are the wall-clock values in the configured zone,
   startUtc is the same instant in UTC. Bookings are keyed on
   date+time, which is unambiguous in the zone.
   ===================================================================== */

import { BOOKING_CONFIG as C } from "./_booking-config.js";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: C.timezone,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23"
});

const pad = n => String(n).padStart(2, "0");

/* Wall-clock parts of an instant, in the configured timezone. */
export function zonedParts(instant) {
  const out = {};
  for (const p of partsFmt.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out; // { year, month, day, hour, minute, second }
}

/* The zone's UTC offset (ms) at an instant: the wall clock read as
   UTC minus the instant itself. */
function zoneOffsetMs(utcMs) {
  const p = zonedParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/* The UTC instant of a wall-clock time in the configured zone.
   Two passes: the offset at the naive guess, then the offset at
   the corrected instant — the second pass settles the DST edges. */
export function zonedTimeToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = guess - zoneOffsetMs(guess);
  utc = guess - zoneOffsetMs(utc);
  return new Date(utc);
}

const START_MIN = C.startHour * 60 + C.startMinute;
const END_MIN = C.endHour * 60 + C.endMinute;

/* Blocked start-ranges (minutes since midnight) for a weekday,
   from the config's recurring weekly blocked windows. */
function blockedRangesFor(weekday) {
  return (C.blockedWindows || [])
    .filter(w => w.weekday === weekday)
    .map(w => [
      w.startHour * 60 + w.startMinute,
      w.endHour * 60 + w.endMinute
    ]);
}

/* Every bookable slot from `now` forward, minus the booked ones.
   `booked` is an array of records (or {date, time} pairs) already
   in the store. Excludes: non-configured weekdays, slots starting
   before now + minNoticeHours, slots starting inside a configured
   blocked window, and booked slots. */
export function generateSlots(now = new Date(), booked = []) {
  const bookedKeys = new Set(
    (booked || []).map(b => `${b && b.date}T${b && b.time}`)
  );
  const earliest = now.getTime() + C.minNoticeHours * 3600 * 1000;
  const today = zonedParts(now);
  const slots = [];
  for (let i = 0; i < C.daysAhead; i++) {
    /* Advance whole calendar days on the abstract date — weekday
       of a calendar date is a property of the date itself. */
    const dayMs = Date.UTC(today.year, today.month - 1, today.day + i);
    const day = new Date(dayMs);
    if (!C.weekdays.includes(day.getUTCDay())) continue;
    const blocked = blockedRangesFor(day.getUTCDay());
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const date = `${y}-${pad(mo)}-${pad(d)}`;
    for (let t = START_MIN; t + C.slotMinutes <= END_MIN; t += C.slotMinutes) {
      if (blocked.some(([bs, be]) => t >= bs && t < be)) continue;
      const time = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
      if (bookedKeys.has(`${date}T${time}`)) continue;
      const start = zonedTimeToUtc(y, mo, d, Math.floor(t / 60), t % 60);
      if (start.getTime() < earliest) continue;
      slots.push({ date, time, startUtc: start.toISOString() });
    }
  }
  return slots;
}

/* Is this exact date+time a slot the rules would offer right now
   (ignoring whether it is already booked)? Server-side re-check of
   anything the page submits. */
export function isOfferedSlot(date, time, now = new Date()) {
  return generateSlots(now, []).some(s => s.date === date && s.time === time);
}

/* "Wednesday, November 18, 2026 at 2:30 PM EST" — for emails and
   confirmations, always rendered in the configured zone. */
export function describeSlot(startUtc) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: C.timezone,
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short"
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(startUtc))) parts[p.type] = p.value;
  return `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year} at ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
}
