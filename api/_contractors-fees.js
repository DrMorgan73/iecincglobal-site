/* =====================================================================
   IEC Contractor Portal — REFERRAL FEE SCHEDULE (single source of
   truth for the portal's fee math and fee display).

   Source of record: the IEC Contractor Referral Fee Schedule
   (~/workspace/your_files/iec-contractor-referral-fee-schedule-2026-11-11.md).

   Performance principle APPROVED by DrMorgan 2026-11-11 14:31 EST:
   "I will pay scalable on performance" — the fee is paid ONLY when
   a referred client's first license closes, and the amount scales
   with what the owner grosses on that license.

   ADOPTED by DrMorgan 2026-11-12: the fee is a flat 5% of the
   OWNER GROSS (the gross amount the referred owner receives on the
   first closed license, before IEC's client fee), with NO CAP,
   plus a milestone bonus of a further 2% of the Owner Gross when
   the Owner Gross reaches $10,000,000 (7% in total at that level).
   Renewals are unpaid (first closed license only) — an adopted
   term, not an open ruling. No rulings remain open on this schedule.

   The fee comes from IEC's share ONLY — the percentages are the
   measure; the owner's money is never touched, the fee is never
   charged to the client, and it is never taken from any channel.
   Route-independent: the same schedule whether the license closes
   direct or through a channel. Contractors are IEC contractors,
   NOT producers and NOT under any channel agreement — no channel
   name appears anywhere in this module.
   ===================================================================== */

export const FEE_SCHEDULE = {
  status: 'ADOPTED',
  adoptedOn: '2026-11-12',
  basis: 'Owner Gross',
  baseRate: 0.05,          // 5% of the Owner Gross
  bonusThreshold: 10000000, // milestone bonus from $10,000,000 Owner Gross
  bonusRate: 0.02,          // +2% of the Owner Gross at that level
  cap: null,                // NO CAP — adopted 2026-11-12, cap dropped entirely
  paidWithinDays: 15,       // due within 15 days after IEC is paid
  openRulings: []
};

/* Referral fee on an Owner Gross: floor(5% x gross), plus
   floor(2% x gross) once the gross reaches $10,000,000. Returns
   integer dollars. Examples (audited in scripts/contractors.test.mjs):
     $100,000 -> $5,000 · $216,000 -> $10,800 · $250,000 -> $12,500
     $500,000 -> $25,000 · $1,000,000 -> $50,000
     $10,000,000 -> $700,000 ($500,000 base + $200,000 bonus) */
export function referralFee(ownerGross) {
  const v = Number(ownerGross);
  if (!Number.isFinite(v) || v <= 0) return 0;
  let fee = Math.floor(v * FEE_SCHEDULE.baseRate);
  if (v >= FEE_SCHEDULE.bonusThreshold) fee += Math.floor(v * FEE_SCHEDULE.bonusRate);
  return fee;
}

/* Worked examples for the fee-schedule display — computed, never
   hand-typed, so the page can never disagree with the math. */
export function feeExamples() {
  return [100000, 216000, 250000, 500000, 1000000, 10000000]
    .map(v => ({
      ownerGross: v,
      fee: referralFee(v),
      bonus: v >= FEE_SCHEDULE.bonusThreshold
    }));
}

export function formatUSD(n) {
  return '$' + Number(n).toLocaleString('en-US');
}
