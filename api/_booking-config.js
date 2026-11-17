/* =====================================================================
   IEC — "Book a call" availability configuration.

   THIS IS THE ONE PLACE booking availability is defined. To change
   DrMorgan's availability, edit the values below and redeploy —
   the public page (book.html), the slot generator
   (api/_booking-slots.js) and the endpoint (api/book.js) all read
   from here and nowhere else.

   Times are wall-clock in `timezone` (America/New_York). The last
   slot of the day STARTS at endTime minus slotMinutes, so with the
   defaults the final bookable start is 4:30 PM for a 5:00 PM end.
   ===================================================================== */

export const BOOKING_CONFIG = {
  /* IANA timezone every rule below is expressed in. */
  timezone: "America/New_York",

  /* Bookable weekdays — JavaScript convention: 0 = Sunday …
     6 = Saturday. Default: Monday–Friday. */
  weekdays: [1, 2, 3, 4, 5],

  /* First slot of the day starts at startHour:startMinute. */
  startHour: 9,
  startMinute: 0,

  /* The day ends at endHour:endMinute — the last slot starts one
     slot-length before it. */
  endHour: 17,
  endMinute: 0,

  /* Meeting length, in minutes. */
  slotMinutes: 30,

  /* A slot must start at least this many hours from now. */
  minNoticeHours: 2,

  /* How many calendar days ahead (starting today, in `timezone`)
     the picker offers. */
  daysAhead: 14
};
