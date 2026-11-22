/* =====================================================================
   SEALED — INTERNAL ONLY. NEVER PARTNER-FACING.

   Schedule B Entry 1 — Identification Record (Eleanor's ruling,
   Nov 22, 2026). Maps the functional description in the restated
   Entry 1 to the full legal identity in the original entry.

   This module is imported by NO API handler and NO page. It is
   not served at any public path (files under api/ return 404 on
   the public site), it is never rendered by any portal action,
   and no route returns its contents — to an unauthenticated
   caller or to a partner-authenticated one. It exists solely as
   IEC's internal evidentiary record. The test suite asserts that
   no handler imports it.
   ===================================================================== */

export const IDENTIFICATION_RECORD = {
  record: 'Schedule B Entry 1 — Identification Record',
  internal: true,
  partnerFacing: false,
  instrument: 'IEC General CNDA and Procuring Party Agreement — Schedule B, Entry 1',
  functionalDescription:
    "The data-licensing channel, marketplace, and program first disclosed by IEC to Counterparty on or before the Effective Date, through which IEC presents data-monetization opportunities and with which IEC is Counterparty's producer of record, including that channel, marketplace, and program under any present or future name, brand, or platform, its parents, subsidiaries, affiliates, successors, and assigns, its officers, directors, employees, agents, and representatives acting for it, and its sponsor and upline chain and any other intermediary through whom its programs may be accessed.",
  fullLegalIdentity:
    "Chang Strategic Ltd., operating as DataSupply.ai (datasupply.ai), including its sponsor and upline chain (including NexMed Consulting and Tom Schaefer) and any other intermediary through whom DataSupply.ai's programs may be accessed.",
  originalOpportunity:
    "Data monetization of Counterparty's data through the DataSupply.ai channel; IEC is Counterparty's producer of record.",
  basis:
    "Section 5.3 restatement (Eleanor's ruling, Nov 22, 2026): delivery and non-objection; no partner re-execution required. Fallback on written objection within 5 business days: initialled/countersigned entry or a Section 14.5 signed amendment, for that partner only."
};
