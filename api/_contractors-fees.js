/* =====================================================================
   IEC Contractor Portal — REFERRAL FEE SCHEDULE (single source of
   truth for the portal's fee math and fee display).

   Source of record: the IEC Contractor Referral Fee Schedule
   (~/workspace/your_files/iec-contractor-referral-fee-schedule-2026-11-11.md).

   Performance principle APPROVED by DrMorgan 2026-11-11 14:31 EST:
   "I will pay scalable on performance" — the fee is paid ONLY when
   a referred client's first license closes, and the amount scales
   with that license's value.

   DRAFT — two rulings still open (do not hard-code around them):
     (1) cap level — currently $25,000 per license;
     (2) renewals — currently unpaid (first closed license only).

   The fee comes from IEC's share ONLY — never the owner's 80%,
   never charged to the client, never taken from any channel.
   Route-independent: the same schedule whether the license closes
   direct or through a channel. Contractors are IEC contractors,
   NOT producers and NOT under any channel agreement — no channel
   name appears anywhere in this module.
   ===================================================================== */

export const FEE_SCHEDULE = {
  status: 'DRAFT',
  basis: 'first closed license value',
  brackets: [
    { upTo: 250000, rate: 0.02 },   // 2.0% of the first $250,000
    { upTo: 1000000, rate: 0.01 },  // 1.0% of the next $750,000
    { upTo: Infinity, rate: 0.005 } // 0.5% above $1,000,000
  ],
  cap: 25000,            // maximum referral fee on any one license
  paidWithinDays: 15,    // due within 15 days after IEC is paid
  openRulings: ['cap level ($25,000)', 'renewals unpaid (first license only)']
};

/* Bracketed fee on a license value, capped. Returns integer dollars.
   Examples (audited in scripts/contractors.test.mjs):
     $100,000 -> $2,000 · $250,000 -> $5,000 · $500,000 -> $7,500
     $1,000,000 -> $12,500 · $2,000,000 -> $17,500
     $5,000,000 -> $25,000 (capped) · $14,500,000 -> $25,000 (capped) */
export function referralFee(licenseValue) {
  const v = Number(licenseValue);
  if (!Number.isFinite(v) || v <= 0) return 0;
  let fee = 0;
  let prev = 0;
  for (const b of FEE_SCHEDULE.brackets) {
    const slice = Math.min(v, b.upTo) - prev;
    if (slice > 0) fee += slice * b.rate;
    prev = b.upTo;
    if (v <= b.upTo) break;
  }
  return Math.min(Math.floor(fee), FEE_SCHEDULE.cap);
}

/* Worked examples for the fee-schedule display — computed, never
   hand-typed, so the page can never disagree with the math. */
export function feeExamples() {
  return [100000, 250000, 500000, 1000000, 2000000, 5000000, 14500000]
    .map(v => ({ licenseValue: v, fee: referralFee(v), capped: uncappedFee(v) > FEE_SCHEDULE.cap }));
}

function uncappedFee(licenseValue) {
  const v = Number(licenseValue);
  if (!Number.isFinite(v) || v <= 0) return 0;
  let fee = 0;
  let prev = 0;
  for (const b of FEE_SCHEDULE.brackets) {
    const slice = Math.min(v, b.upTo) - prev;
    if (slice > 0) fee += slice * b.rate;
    prev = b.upTo;
    if (v <= b.upTo) break;
  }
  return Math.floor(fee);
}

export function formatUSD(n) {
  return '$' + Number(n).toLocaleString('en-US');
}
