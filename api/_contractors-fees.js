/* =====================================================================
   IEC Contractor Portal — REFERRAL FEE SCHEDULE (single source of
   truth for the portal's fee math and fee display).

   Source of record: the IEC Contractor Referral Fee Schedule
   (~/workspace/your_files/iec-contractor-referral-fee-schedule-2026-11-11.md).

   Performance principle APPROVED by DrMorgan 2026-11-11 14:31 EST:
   "I will pay scalable on performance" — the fee is paid ONLY when
   a referred client's first license closes, and the amount scales
   with what the owner grosses on that license.

   ADOPTED by DrMorgan 2026-11-19: the fee is a percentage of the
   OWNER GROSS (the gross amount the referred owner receives on the
   first closed license) on a two-tier scale — 3% of the first
   $250,000 of the Owner Gross, plus 1% of the Owner Gross above
   $250,000 — with NO CAP. This supersedes the flat 5% standard
   adopted 2026-11-12 (and its $10,000,000 milestone bonus, which is
   removed entirely). Renewals are unpaid (first closed license
   only) — an adopted term, not an open ruling. No rulings remain
   open on this schedule.

   The fee is payable by IEC — the percentages are the measure;
   it is never deducted from, or charged against, any amount
   payable to the owner, and it is never taken from any channel.
   Route-independent: the same schedule whether the license closes
   direct or through a channel. Contractors are IEC contractors,
   NOT producers and NOT under any channel agreement — no channel
   name appears anywhere in this module.
   ===================================================================== */

export const FEE_SCHEDULE = {
  status: 'ADOPTED',
  adoptedOn: '2026-11-19',
  basis: 'Owner Gross',
  tierThreshold: 250000, // the first $250,000 of the Owner Gross
  tierRate: 0.03,         // 3% of the first $250,000 of the Owner Gross
  aboveRate: 0.01,        // 1% of the Owner Gross above $250,000
  cap: null,              // NO CAP — adopted 2026-11-12, cap dropped entirely
  paidWithinDays: 15,     // due within 15 days after IEC is paid
  openRulings: []
};

/* Referral fee on an Owner Gross: floor(3% x first $250,000), plus
   floor(1% x the amount above $250,000). Returns integer dollars.
   Examples (audited in scripts/contractors.test.mjs):
     $100,000 -> $3,000 · $250,000 -> $7,500 · $500,000 -> $10,000
     $1,000,000 -> $15,000 · $2,000,000 -> $25,000 */
export function referralFee(ownerGross) {
  const v = Number(ownerGross);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const first = Math.min(v, FEE_SCHEDULE.tierThreshold);
  return Math.floor(first * FEE_SCHEDULE.tierRate)
    + Math.floor((v - first) * FEE_SCHEDULE.aboveRate);
}

/* Worked examples for the fee-schedule display, presented in
   BANDS (DrMorgan, 2026-11-19) — computed from the fee math at the
   band edges, never hand-typed, so the page can never disagree
   with the math. The open top band carries one anchor example. */
export function feeExamples() {
  const bands = [[100000, 250000], [250000, 500000], [500000, 1000000], [1000000, null]];
  return bands.map(([from, to]) => ({
    ownerGrossFrom: from,
    ownerGrossTo: to,
    feeFrom: referralFee(from),
    feeTo: to === null ? null : referralFee(to),
    anchorGross: to === null ? 2000000 : null,
    anchorFee: to === null ? referralFee(2000000) : null
  }));
}

export function formatUSD(n) {
  return '$' + Number(n).toLocaleString('en-US');
}
