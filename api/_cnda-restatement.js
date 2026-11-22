/* =====================================================================
   IEC Partner Portal — Schedule B Entry 1 restatement (Eleanor's
   ruling, Nov 22, 2026).

   The CNDA text of record (api/_cnda-content.js, generated from
   cnda.html) carries Entry 1 in its RESTATED form — that is what
   NEW signers sign. EXISTING partner signers signed the original
   named Entry 1; their rendered copy keeps the as-signed Entry 1
   until the Section 5.3 restatement takes effect for them
   (delivery + 5 business days without written objection), after
   which their copy renders the restated Entry 1 with the
   provenance line. Already-issued copies are never altered.

   This module is pure: it holds the two Entry 1 texts, the
   business-day computation, and the Schedule B renderer used by
   api/_partner-documents.js. The delivery notices themselves are
   NOT sent by any code here — they are office drafts, gated on
   DrMorgan's send word.
   ===================================================================== */

/* Entry 1 as originally signed by existing partner signers
   (pre-restatement text of record). Rendered ONLY for a partner
   whose restatement is not yet effective. */
export const ENTRY1_AS_SIGNED = [
  'Entry 1 — Effective Date',
  "Introduced Party: Chang Strategic Ltd., operating as DataSupply.ai (datasupply.ai), including its sponsor and upline chain (including NexMed Consulting and Tom Schaefer) and any other intermediary through whom DataSupply.ai's programs may be accessed.",
  "Opportunity: Data monetization of Counterparty's data through the DataSupply.ai channel; IEC is Counterparty's producer of record.",
  'Initials: IEC ______  Counterparty ______'
].join('\n');

/* Entry 1 as restated under Section 5.3 — verbatim per Eleanor's
   ruling. Must match the Entry 1 carried in the CNDA text of
   record for new signers (asserted by the test suite against
   api/_cnda-content.js). */
export const ENTRY1_RESTATED = [
  'Entry 1 — Effective Date, as restated under Section 5.3',
  "Introduced Party: The data-licensing channel, marketplace, and program first disclosed by IEC to Counterparty on or before the Effective Date, through which IEC presents data-monetization opportunities and with which IEC is Counterparty's producer of record, including that channel, marketplace, and program under any present or future name, brand, or platform, its parents, subsidiaries, affiliates, successors, and assigns, its officers, directors, employees, agents, and representatives acting for it, and its sponsor and upline chain and any other intermediary through whom its programs may be accessed.",
  "Opportunity: Data monetization of Counterparty's data through that channel, marketplace, and program; IEC is Counterparty's producer of record.",
  'Initials: IEC ______ Counterparty ______ (initials or countersignature if provided; otherwise this entry takes effect by delivery and non-objection under Section 5.3)'
].join('\n');

/* Proper names that must never appear in a partner-facing render
   for a post-effectiveness copy, or in new-signer CNDA content. */
export const CNDA_BANNED_NAMES = ['DataSupply', 'datasupply.ai', 'Chang Strategic', 'NexMed', 'Tom Schaefer'];

/* Add `n` business days (Mon–Fri) to a YYYY-MM-DD date. */
export function addBusinessDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return '';
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

/* The restatement state for one contractor record:
   { deliveredDate, effectiveDate, objected } — dates are
   YYYY-MM-DD or ''. Effectiveness: a delivered restatement with
   no recorded objection is effective on its effective date
   (delivered + 5 business days, computed and stored when the
   delivery is recorded; an explicitly stored effective date
   governs). An objected restatement never takes effect through
   this mechanism (the fallback is a signed amendment for that
   partner only). */
export function restatementState(c) {
  return {
    deliveredDate: dateOnly(c && c.cndaEntry1RestatementDeliveredAt),
    effectiveDate: dateOnly(c && c.cndaEntry1RestatementEffectiveAt),
    objected: !!(c && c.cndaEntry1RestatementObjected)
  };
}

export function restatementEffective(c, today = new Date().toISOString().slice(0, 10)) {
  const s = restatementState(c);
  if (!s.deliveredDate || s.objected) return false;
  const eff = s.effectiveDate || addBusinessDays(s.deliveredDate, 5);
  return today >= eff;
}

export function restatementProvenanceLine(c) {
  const s = restatementState(c);
  const eff = s.effectiveDate || (s.deliveredDate ? addBusinessDays(s.deliveredDate, 5) : '');
  return `Entry 1 as restated under Section 5.3; delivered ${s.deliveredDate}; effective ${eff}. The executed original is held by IEC.`;
}

/* Render the Schedule B text for one partner: swap the Entry 1
   block (the text of record carries the restated form) for the
   as-signed form while that partner's restatement is not yet
   effective, or append the provenance line once it is. Partners
   with no signed CNDA on record get the text of record as-is. */
export function scheduleBForPartner(scheduleBText, c, today) {
  const text = String(scheduleBText || '');
  if (!c || c.ndaStatus !== 'signed') return text;
  if (!text.includes(ENTRY1_RESTATED)) return text;
  if (restatementEffective(c, today)) {
    return text.replace(ENTRY1_RESTATED, `${ENTRY1_RESTATED}\n${restatementProvenanceLine(c)}`);
  }
  return text.replace(ENTRY1_RESTATED, ENTRY1_AS_SIGNED);
}

/* The Section 5.3 / Section 14.3 delivery notice for one partner
   — DRAFT ONLY. This builds the package the office sends when
   DrMorgan gives the send word; nothing here sends anything. */
export function buildRestatementNotice(c, deliveredDate) {
  const deadline = addBusinessDays(deliveredDate, 5);
  const name = (c && c.name) || '';
  const company = (c && c.company) || '';
  const subject = 'IEC General CNDA and Procuring Party Agreement — Schedule B Entry 1 restated under Section 5.3';
  const text = [
    `Dear ${name},`,
    '',
    'This notice is given under Section 14.3 of the IEC General CNDA and Procuring Party Agreement (the "Agreement") between IEC, Inc. and ' + (company || name) + '.',
    '',
    'Delivery is made under Section 5.3 of the Agreement. Schedule B Entry 1 is restated as follows, verbatim:',
    '',
    ENTRY1_RESTATED,
    '',
    `If you object to this restated entry, please do so in writing within 5 business days of this delivery — by ${deadline}. If no written objection is received by that date, the restated entry takes effect and becomes the Entry 1 of record under the Agreement.`,
    '',
    'No action is needed if you do not object.',
    '',
    'Mohammed Morgan, MD',
    'Founder & CEO, IEC, Inc. · Head of IEC MSO',
    'iecincglobal.com | 857-867-1767',
    'info@iecincglobal.com'
  ].join('\n');
  return { subject, text, deadline, deliveredDate };
}

export const _internals = { dateOnly };
