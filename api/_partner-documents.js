/* =====================================================================
   IEC Partner Portal — the partner's OWN signed instruments.

   DataSupply's shape, mirrored: the partner can READ his signed
   Contractor Referral Agreement and his signed CNDA inside the
   portal, and DOWNLOAD a PDF of each — his signed copy, carrying
   his acceptance of record on it.

   Discipline:
   - Both documents render from the texts of record — the
     generated agreement text (api/_agreement-content.js) and the
     central CNDA text (api/_cnda-content.js). Neither legal text
     is edited here; PDFs are generated on request from the
     record, never stored as static files.
   - The acceptance block carries ONLY what the record holds.
     An in-portal acceptance renders the typed legal name, the
     version, and the exact timestamp. An office-recorded
     (paper) signature renders the office-recorded line instead —
     no timestamp, name, or signature is ever invented. The
     partner's CNDA was signed on IEC's CNDA signing page and
     recorded by IEC; the portal record holds the signed STATUS,
     not a timestamp, so the CNDA block says exactly that.
   - This module is pure: it takes a contractor record and
     returns { title, html, blocks } (blocks feed
     api/_data-assets-pdf.js blocksToPdf). The API layer serves
     the result only through the partner's own session — there
     is no id parameter anywhere, so another partner's copy
     cannot be named.
   ===================================================================== */

import {
  AGREEMENT_HTML, AGREEMENT_TEXT, agreementVersionId
} from './_agreement-content.js';
import {
  CNDA_TEXTS, CNDA_TITLES, CNDA_SIGNATORY, CNDA_IEC_STATE,
  CNDA_DEFAULT_PURPOSE, fillCndaText, escapeHtml
} from './_cnda-content.js';
import { scheduleBForPartner } from './_cnda-restatement.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = n => String(n).padStart(2, '0');

/* Deterministic UTC renderings of an ISO timestamp — the same
   instant reads identically in the portal, the PDF, and the
   tests (no locale or timezone drift). */
export function fmtUtc(iso) {
  const d = new Date(iso || '');
  if (isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} `
    + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}
export function fmtDateUtc(iso) {
  const d = new Date(iso || '');
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/* The in-portal acceptance of record for one contractor, or null
   when the agreement was signed on paper and recorded by the
   office (or is not signed at all). Mirrors agreementAcceptance
   in api/contractors.js — the same record fields, the same rule. */
export function acceptanceOf(c) {
  if (!c || (c.agreementStatus || 'pending') !== 'signed') return null;
  if ((c.agreementAcceptedVia || '') !== 'portal') return null;
  return {
    name: c.agreementAcceptedName || '',
    at: c.agreementSignedAt || null,
    version: c.agreementAcceptedVersion || '',
    via: 'portal'
  };
}

/* The CNDA mirror (Nov 25, 2026): the in-portal CNDA signing of
   record for one contractor, or null when the CNDA was signed
   outside the portal and recorded by the office (or is not
   signed at all). Same rule as acceptanceOf — 'portal' only
   when the partner signed it inside the portal. */
export function ndaAcceptanceOf(c) {
  if (!c || c.ndaStatus !== 'signed') return null;
  if ((c.ndaAcceptedVia || '') !== 'portal') return null;
  return {
    name: c.ndaAcceptedName || '',
    at: c.ndaSignedAt || null,
    version: c.ndaVersion || '',
    via: 'portal'
  };
}

/* ---------------- the agreement ---------------- */

/* AGREEMENT_TEXT (the plain-text render of the instrument) as
   PDF blocks: article headings become h2, Exhibit sub-headings
   h3, everything else a paragraph. Line 0 is the title —
   blocksToPdf prints it, so it is not repeated as a block. */
function agreementTextBlocks() {
  const blocks = [];
  AGREEMENT_TEXT.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || i === 0) return;
    if (/^\d+\.\s+(?!\d)/.test(line) || /^EXHIBIT/.test(line)) blocks.push({ t: 'h2', text: line });
    else if (/^A\.\d+\s/.test(line) || /^Worked examples/.test(line)) blocks.push({ t: 'h3', text: line });
    else blocks.push({ t: 'p', text: line });
  });
  return blocks;
}

function agreementAcceptance(c) {
  const a = acceptanceOf(c);
  if (a) {
    const lines = [
      `Accepted and signed in the IEC Partner Portal by: **${a.name}**`,
      `Agreement version: **${a.version}**`,
      `Date and time of acceptance (UTC): **${fmtUtc(a.at)}**`,
      'The typed legal name and the accept action in the Partner Portal are the signature of record. '
      + 'Receiving the agreement by email alone does not count as acceptance.'
    ];
    const html = '<div class="pp-acceptance"><h2>Acceptance of record</h2>'
      + `<p>Accepted and signed in the IEC Partner Portal by: <strong>${escapeHtml(a.name)}</strong></p>`
      + `<p>Agreement version: <strong>${escapeHtml(a.version)}</strong></p>`
      + `<p>Date and time of acceptance (UTC): <strong>${escapeHtml(fmtUtc(a.at))}</strong></p>`
      + '<p>The typed legal name and the accept action in the Partner Portal are the signature of record. '
      + 'Receiving the agreement by email alone does not count as acceptance.</p></div>';
    return { lines, html, acceptance: a };
  }
  /* Paper-signed, office-recorded: the office line, and nothing
     the record does not hold. */
  const when = fmtDateUtc(c.agreementSignedAt);
  const line = `Agreement: signed — recorded by the IEC office${when ? ` ${when}` : ''}.`;
  const lines = [
    line,
    'This agreement was signed on paper outside the portal; the executed original is held by IEC. '
    + 'No portal acceptance exists for it, and none is shown.'
  ];
  const html = '<div class="pp-acceptance"><h2>Acceptance of record</h2>'
    + `<p>${escapeHtml(line)}</p>`
    + '<p>This agreement was signed on paper outside the portal; the executed original is held by IEC. '
    + 'No portal acceptance exists for it, and none is shown.</p></div>';
  return { lines, html, acceptance: null };
}

/* The partner's signed agreement: full text + his acceptance of
   record. Null while the agreement is not signed. */
export function partnerAgreementDocument(c) {
  if (!c || (c.agreementStatus || 'pending') !== 'signed') return null;
  const acc = agreementAcceptance(c);
  const blocks = agreementTextBlocks();
  blocks.push({ t: 'h2', text: 'Acceptance of record' });
  blocks.push({ t: 'p', text: `This is the signed copy of **${c.name || ''}**${c.company ? ` (${c.company})` : ''}, generated from IEC's records.` });
  for (const line of acc.lines) blocks.push({ t: 'p', text: line });
  return {
    title: 'IEC Contractor Referral Agreement',
    version: (acc.acceptance && acc.acceptance.version) || c.agreementAcceptedVersion || agreementVersionId(),
    acceptance: acc.acceptance,
    html: AGREEMENT_HTML + acc.html,
    blocks
  };
}

/* ---------------- the CNDA ---------------- */

/* The values the partner's record genuinely holds, in the
   central instrument's fill shape. Fields the record does not
   hold stay unfilled — fillCndaText leaves the instrument's own
   bracketed placeholder, exactly as the central flow does. The
   purpose is the instrument's own pre-filled default and IEC's
   state is the instrument's own fact (the same choices the
   owner-CNDA issuance makes). */
export function cndaValues(c) {
  const address = [c.addressStreet, c.addressCity, c.addressState, c.addressZip]
    .filter(Boolean).join(', ');
  return {
    party: c.company || c.name || '',
    address,
    entityTypeState: '',
    effectiveDate: '',
    purpose: CNDA_DEFAULT_PURPOSE,
    iecState: CNDA_IEC_STATE
  };
}

const CNDA_ACCEPTANCE_TEXT =
  'IEC records this Confidentiality Agreement (CNDA) as signed by the Counterparty and recorded '
  + 'on the partner\u2019s IEC Partner Portal record (NDA: signed). The partner signed the CNDA on '
  + 'IEC\u2019s CNDA signing page; the executed original is held by IEC.';

/* The partner's signed CNDA: the central text, unaltered, filled
   with his record's values, closed by the instrument's execution
   language carrying the facts of record — IEC pre-signed (the
   instrument's own posture; DrMorgan's signature image of record
   in the HTML view when the caller supplies it, his typed name
   otherwise — the central renderer's own fallback) and the
   Counterparty's electronic signature as recorded. Null while
   the NDA is not signed. */
export function partnerCndaDocument(c, { iecSignatureImg = '' } = {}) {
  if (!c || c.ndaStatus !== 'signed') return null;
  const values = cndaValues(c);
  /* The §14 text as extracted from cnda.html carries the page's
     trailing matter inside it — the blank AGREED AND ACCEPTED
     block and both Schedules — while Schedules A and B are also
     their own texts below and the Execution section is
     constructed here. Rendering §14 whole would print both
     Schedules (and a second signature block) twice in the
     partner's copy. Trim §14 at the trailing-matter marker so
     every part of the instrument renders exactly once; no word
     of Articles 1–14 is touched. (Audit fix, 2026-11-22.) */
  const bodyTexts = CNDA_TEXTS.slice(0, CNDA_TEXTS.length - 1).map((text, idx) => {
    const marker = text.indexOf('\n\n---\n\nAGREED AND ACCEPTED');
    const trimmed = marker > 0 ? text.slice(0, marker) : text;
    /* Schedule A (index 15) is complete in its own text; the copy
       inside §14's trailing matter is trimmed above. */
    if (idx === 15) return trimmed;
    return trimmed;
  });
  /* Schedule B (index 16) renders per this partner's Section 5.3
     restatement state: as-signed before effectiveness, restated
     + provenance line after it (Eleanor's ruling, Nov 22, 2026).
     EXCEPTION (Nov 25, 2026): a partner who signed the CNDA
     INSIDE the portal signed the text of record — the restated
     Entry 1 — so his copy renders it exactly as signed; the
     as-signed swap would alter what he signed. */
  const ndaAcc = ndaAcceptanceOf(c);
  if (bodyTexts[16] && !ndaAcc) bodyTexts[16] = scheduleBForPartner(bodyTexts[16], c);

  /* HTML fragment (the portal reader injects it, like the
     agreement's AGREEMENT_HTML fragment). */
  const sections = bodyTexts.map((text, index) => {
    const heading = index === 0 ? '' : `<h2>${escapeHtml(CNDA_TITLES[index])}</h2>`;
    return `<section${index === 0 ? ' class="intro"' : ''}>${heading}<p>${escapeHtml(fillCndaText(text, values))}</p></section>`;
  }).join('');
  const iecSig = iecSignatureImg
    ? `<p>Signature: <img src="${iecSignatureImg}" alt="Mohammed Morgan, MD" style="height:44px;vertical-align:middle"></p>`
    : '<p>Signature: <em>Mohammed Morgan, MD</em></p>';
  /* The Counterparty signature line carries the facts of
     record: a portal signer shows his typed signature and the
     date he signed (the same posture as the central CNDA
     renderer); an office-recorded signature keeps the held-by-
     IEC line — no portal evidence is invented for it. */
  const counterpartySigHtml = ndaAcc
    ? `<p>Signature: <em>${escapeHtml(ndaAcc.name)}</em></p>`
      + `<p>Name: ${escapeHtml(ndaAcc.name)}</p>`
      + (c.email ? `<p>Email: ${escapeHtml(c.email)}</p>` : '')
      + `<p>Date: ${escapeHtml(fmtDateUtc(ndaAcc.at))}</p>`
    : '<p>Signature: <em>signed electronically — the signature of record is held by IEC</em></p>'
      + `<p>Name: ${escapeHtml(c.name || '')}</p>`
      + (c.email ? `<p>Email: ${escapeHtml(c.email)}</p>` : '');
  const executionHtml = '<section class="execution"><h2>Execution</h2>'
    + '<p><strong>IN WITNESS WHEREOF</strong>, the Parties have executed this Agreement as of the Effective Date.</p>'
    + '<div class="signatures">'
    + '<div><h3>International Empire Consultants, Inc.</h3><p>(Pre-signed by IEC)</p>' + iecSig
    + '<p>Name: Mohammed Morgan, MD</p><p>Title: Founder &amp; CEO</p></div>'
    + `<div><h3>${escapeHtml(values.party)}</h3>`
    + counterpartySigHtml
    + '</div></div></section>';
  const acceptanceHtml = ndaAcc
    ? '<div class="pp-acceptance"><h2>Acceptance of record</h2>'
      + `<p>Signed in the IEC Partner Portal by: <strong>${escapeHtml(ndaAcc.name)}</strong></p>`
      + `<p>CNDA text version: <strong>${escapeHtml(ndaAcc.version)}</strong></p>`
      + `<p>Date and time of signing (UTC): <strong>${escapeHtml(fmtUtc(ndaAcc.at))}</strong></p>`
      + '<p>The typed legal name and the sign action in the Partner Portal are the signature of record. '
      + 'Receiving the CNDA by email alone does not count as signing.</p></div>'
    : '<div class="pp-acceptance"><h2>Acceptance of record</h2>'
      + `<p>${escapeHtml(CNDA_ACCEPTANCE_TEXT)}</p></div>`;
  const html = '<header><h1>General CNDA and Procuring Party Agreement</h1>'
    + `<p>International Empire Consultants, Inc. and ${escapeHtml(values.party)}</p></header>`
    + sections + executionHtml + acceptanceHtml;

  /* PDF blocks: the same document, text form. */
  const blocks = [];
  bodyTexts.forEach((text, index) => {
    if (index > 0) blocks.push({ t: 'h2', text: CNDA_TITLES[index] });
    for (const para of fillCndaText(text, values).split(/\n+/)) {
      if (para.trim()) blocks.push({ t: 'p', text: para.trim() });
    }
  });
  blocks.push({ t: 'h2', text: 'Execution' });
  blocks.push({ t: 'p', text: 'IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.' });
  blocks.push({ t: 'p', text: '**International Empire Consultants, Inc.** (Pre-signed by IEC)' });
  blocks.push({ t: 'p', text: `Signature: ${CNDA_SIGNATORY.name} — Name: ${CNDA_SIGNATORY.name} — Title: Founder & CEO` });
  blocks.push({ t: 'p', text: `**${values.party}**` });
  blocks.push({
    t: 'p',
    text: ndaAcc
      ? `Signature: ${ndaAcc.name} — Name: ${ndaAcc.name}${c.email ? ` — Email: ${c.email}` : ''} — Date: ${fmtDateUtc(ndaAcc.at)}`
      : `Signature: signed electronically — the signature of record is held by IEC. Name: ${c.name || ''}${c.email ? ` — Email: ${c.email}` : ''}`
  });
  blocks.push({ t: 'h2', text: 'Acceptance of record' });
  if (ndaAcc) {
    blocks.push({ t: 'p', text: `Signed in the IEC Partner Portal by: **${ndaAcc.name}**` });
    blocks.push({ t: 'p', text: `CNDA text version: **${ndaAcc.version}**` });
    blocks.push({ t: 'p', text: `Date and time of signing (UTC): **${fmtUtc(ndaAcc.at)}**` });
    blocks.push({
      t: 'p',
      text: 'The typed legal name and the sign action in the Partner Portal are the signature of record. '
        + 'Receiving the CNDA by email alone does not count as signing.'
    });
  } else {
    blocks.push({ t: 'p', text: CNDA_ACCEPTANCE_TEXT });
  }

  return {
    title: 'IEC General CNDA and Procuring Party Agreement',
    acceptance: ndaAcc,
    html,
    blocks
  };
}

export const _internals = { fmtUtc, fmtDateUtc, acceptanceOf, ndaAcceptanceOf, agreementTextBlocks, cndaValues };
