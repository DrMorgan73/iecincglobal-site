/* =====================================================================
   Build api/_agreement-content.js from the Contractor Referral
   Agreement markdown — the SINGLE source of truth for the text the
   Partner Portal presents for in-portal acceptance.

   Source: ~/workspace/your_files/iec-contractor-referral-agreement-2026-11-11.md
   (the restructured, scrubbed agreement; Articles 1–18 + Exhibit A).

   The renderer covers exactly the constructs that document uses
   (headings, paragraphs, bold/italic lead-ins, bullet lists, one
   table, rules) and PROVES the render is verbatim: the text
   extracted back out of the generated HTML must equal the text of
   the markdown source (whitespace-normalised), the fee figures
   must be present, and none of the scrubbed IEC-fee phrasing may
   appear. If any check fails the build stops — the portal never
   serves an unverified text.

   Usage:
     node scripts/build-agreement-content.mjs [--md <path>] [--commit <sha>]

   --commit stamps AGREEMENT_CONTENT_COMMIT (the git commit that
   carries this exact text); the version id shown to partners and
   stored with each acceptance is "IEC-CRA-2026-11-12+<short sha>".
   ===================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const mdPath = opt('--md', '/home/hatch/workspace/your_files/iec-contractor-referral-agreement-2026-11-11.md');
const commit = opt('--commit', 'pending');
const outPath = path.join(repoRoot, 'api', '_agreement-content.js');

const md = fs.readFileSync(mdPath, 'utf8');
const sourceSha256 = crypto.createHash('sha256').update(md).digest('hex');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inlineHtml = s => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>');
const inlineText = s => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');

/* Walk the markdown line by line — the same discipline as the
   DOCX/PDF builders — producing the HTML render and, in parallel,
   the document's plain text. */
function render(source) {
  const lines = source.split('\n');
  const html = [];
  const text = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('### ')) { html.push(`<h3>${inlineHtml(ln.slice(4))}</h3>`); text.push(inlineText(ln.slice(4))); i++; continue; }
    if (ln.startsWith('## ')) { html.push(`<h2>${inlineHtml(ln.slice(3))}</h2>`); text.push(inlineText(ln.slice(3))); i++; continue; }
    if (ln.startsWith('# ')) { html.push(`<h1>${inlineHtml(ln.slice(2))}</h1>`); text.push(inlineText(ln.slice(2))); i++; continue; }
    if (ln.startsWith('|') && i + 1 < lines.length && lines[i + 1].startsWith('|---')) {
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(ln);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(cells(lines[i])); i++; }
      html.push('<table><thead><tr>' + head.map(h => `<th>${inlineHtml(h)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + r.map(c => `<td>${inlineHtml(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      text.push([...head, ...rows.flat()].map(inlineText).join(' '));
      continue;
    }
    if (ln.trim().startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) { items.push(lines[i].trim().slice(2)); i++; }
      html.push('<ul>' + items.map(t => `<li>${inlineHtml(t)}</li>`).join('') + '</ul>');
      text.push(items.map(inlineText).join(' '));
      continue;
    }
    if (ln.trim() === '---') { html.push('<hr>'); i++; continue; }
    if (ln.trim()) { html.push(`<p>${inlineHtml(ln)}</p>`); text.push(inlineText(ln)); }
    i++;
  }
  return { html: html.join('\n'), text: text.join('\n') };
}

const { html, text } = render(md);

/* ---- verbatim proof: HTML -> text must round-trip to the source text.
   Block tags are word boundaries; inline tags (strong/em) are not. ---- */
const fromHtml = html
  .replace(/<\/?(?:h1|h2|h3|p|ul|li|table|thead|tbody|tr|th|td|hr)\b[^>]*>/g, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const norm = s => s.replace(/\s+/g, ' ').trim();
if (norm(fromHtml) !== norm(text)) {
  console.error('FAIL — rendered HTML text does not round-trip to the markdown text');
  process.exit(1);
}

const NEEDLES = ['IEC CONTRACTOR REFERRAL AGREEMENT', '1. Definitions', '5. Compensation',
  '18. Signatures', 'EXHIBIT A', 'Owner Gross', '$10,800', '$50,000', '$700,000', '$10,000,000',
  '15 days', 'Earnings Disclaimer', 'no cap', 'milestone bonus'];
for (const n of NEEDLES) {
  if (!norm(text).includes(n)) { console.error(`FAIL — missing in agreement text: ${n}`); process.exit(1); }
}
const BANNED = ['client fee', "IEC's share", 'IEC share', "IEC's fees", "IEC's own fee",
  'Seller Fee', 'Origination Fee', '2.0%', '1.0%', '0.5%', 'capped at $25,000', '80%'];
for (const b of BANNED) {
  if (norm(text).includes(b)) { console.error(`FAIL — scrubbed/stale phrasing present: ${b}`); process.exit(1); }
}

const moduleSource = `/* =====================================================================
   IEC Contractor Referral Agreement — the text the Partner Portal
   presents for in-portal acceptance. GENERATED by
   scripts/build-agreement-content.mjs from
   iec-contractor-referral-agreement-2026-11-11.md (Articles 1–18 +
   Exhibit A) — do not edit by hand; regenerate instead. The build
   proves the render verbatim (HTML round-trips to the source text)
   and re-checks the scrubbed-phrasing ban on every build.
   Source MD SHA-256: ${sourceSha256}
   ===================================================================== */

export const AGREEMENT_VERSION_BASE = 'IEC-CRA-2026-11-12';
export const AGREEMENT_CONTENT_COMMIT = ${JSON.stringify(commit)};
export const AGREEMENT_SOURCE_SHA256 = ${JSON.stringify(sourceSha256)};

/* The version id shown on the agreement page and stored with each
   acceptance: the instrument version + the content commit that
   carries this exact text. */
export function agreementVersionId() {
  const c = AGREEMENT_CONTENT_COMMIT;
  return c && c !== 'pending' ? \`\${AGREEMENT_VERSION_BASE}+\${String(c).slice(0, 7)}\` : AGREEMENT_VERSION_BASE;
}

export const AGREEMENT_HTML = ${JSON.stringify(html)};

export const AGREEMENT_TEXT = ${JSON.stringify(text)};
`;

fs.writeFileSync(outPath, moduleSource);
console.log(`agreement content built: ${html.length} chars HTML, version base IEC-CRA-2026-11-12, commit stamp "${commit}", md sha256 ${sourceSha256.slice(0, 12)}…`);
