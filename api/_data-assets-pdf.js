/* =====================================================================
   IEC Suite — Data Asset Builder: minimal PDF writer.
   ---------------------------------------------------------------------
   Renders the SAME block structure the Markdown renderer consumes
   (headings, paragraphs, tables, lists) into a valid, text-based
   PDF — standard Helvetica, wrapped text, paginated — with no
   external dependency (the repo carries only @vercel/blob, and the
   export must work inside a plain serverless function). Bold is
   marked with **pairs** in the source text, matching the Markdown
   renderer's convention, and rendered in Helvetica-Bold.
   ===================================================================== */

const PAGE = { w: 612, h: 792, margin: 54 };
const LINE = 13.5;

function escapePdfText(s) {
  return String(s ?? "")
    .replace(/[^\x20-\x7E]/g, ch => (ch === "—" ? "-" : ch === "–" ? "-" : ch === "•" ? "-" : "?"))
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/* Split a paragraph into styled runs: **bold** segments vs plain. */
function runs(text) {
  const parts = String(text ?? "").split("**");
  return parts.map((p, i) => ({ text: p, bold: i % 2 === 1 })).filter(r => r.text.length);
}

function wrapRuns(runList, maxChars) {
  const lines = [];
  let line = [];
  let len = 0;
  const pushWord = (word, bold) => {
    if (len + word.length + (len ? 1 : 0) > maxChars && line.length) {
      lines.push(line); line = []; len = 0;
    }
    if (line.length && len) line.push({ text: " ", bold });
    line.push({ text: word, bold });
    len += word.length + (len ? 1 : 0);
  };
  for (const r of runList) {
    for (const word of r.text.split(/\s+/).filter(Boolean)) {
      if (word.length > maxChars) {
        for (let i = 0; i < word.length; i += maxChars) pushWord(word.slice(i, i + maxChars), r.bold);
      } else pushWord(word, r.bold);
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

export function blocksToPdf(blocks, title) {
  const pages = [];
  let ops = [];
  let y = PAGE.h - PAGE.margin;

  const newPage = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = PAGE.h - PAGE.margin;
  };
  const need = h => { if (y - h < PAGE.margin) newPage(); };
  const textLine = (lineRuns, x, size, color) => {
    let cx = x;
    for (const r of lineRuns) {
      const font = r.bold ? "F2" : "F1";
      const w = r.text.length * size * 0.52;
      ops.push(`BT /${font} ${size} Tf ${color} rg ${cx.toFixed(1)} ${y.toFixed(1)} Td (${escapePdfText(r.text)}) Tj ET`);
      cx += w;
    }
    y -= LINE;
  };
  const para = (text, size, color, indent = 0) => {
    const maxChars = Math.floor((PAGE.w - PAGE.margin * 2 - indent) / (size * 0.52));
    for (const line of wrapRuns(runs(text), maxChars)) {
      need(LINE);
      textLine(line, PAGE.margin + indent, size, color);
    }
    y -= 4;
  };
  const heading = (text, size) => {
    need(LINE * 2.4);
    y -= size * 0.7;
    const maxChars = Math.floor((PAGE.w - PAGE.margin * 2) / (size * 0.52));
    for (const line of wrapRuns([{ text, bold: true }], maxChars)) {
      need(LINE * 1.4);
      textLine(line, PAGE.margin, size, "0.10 0.11 0.16");
    }
    y -= 5;
  };
  const table = (head, rows) => {
    const cols = head.length;
    const width = PAGE.w - PAGE.margin * 2;
    const colW = width / cols;
    const size = cols > 5 ? 6.5 : cols > 3 ? 7.5 : 8.5;
    const charW = size * 0.52;
    const cellLines = cell => wrapRuns(runs(String(cell ?? "")), Math.max(4, Math.floor(colW / charW) - 1));
    const drawRow = (cells, boldAll, bg) => {
      const wrapped = cells.map(cellLines);
      const h = Math.max(...wrapped.map(w => w.length)) * (LINE * 0.82) + 5;
      need(h);
      const top = y;
      if (bg) ops.push(`0.93 0.94 0.96 rg ${PAGE.margin} ${(top - h).toFixed(1)} ${width} ${h} re f`);
      wrapped.forEach((lines, ci) => {
        let ly = top - LINE * 0.82;
        for (const line of lines) {
          let cx = PAGE.margin + ci * colW + 3;
          for (const r of line) {
            const rr = boldAll ? { ...r, bold: true } : r;
            ops.push(`BT /${rr.bold ? "F2" : "F1"} ${size} Tf 0.10 0.11 0.16 rg ${cx.toFixed(1)} ${ly.toFixed(1)} Td (${escapePdfText(rr.text)}) Tj ET`);
            cx += rr.text.length * charW;
          }
          ly -= LINE * 0.82;
        }
      });
      y = top - h;
      ops.push(`0.80 0.82 0.86 RG 0.6 w ${PAGE.margin} ${y.toFixed(1)} m ${(PAGE.margin + width).toFixed(1)} ${y.toFixed(1)} l S`);
    };
    drawRow(head, true, true);
    for (const row of rows) drawRow(row, false, false);
    y -= 8;
  };

  ops.push(`BT /F2 15 Tf 0.10 0.11 0.16 rg ${PAGE.margin} ${y} Td (${escapePdfText(title || "Specimen Package")}) Tj ET`);
  y -= 22;

  for (const b of blocks || []) {
    if (b.t === "h2") heading(b.text, 13.5);
    else if (b.t === "h3") heading(b.text, 11);
    else if (b.t === "p") para(b.text.replace(/^- /, "• "), 9.5, "0.16 0.18 0.24");
    else if (b.t === "list") for (const item of b.items) para(`• ${item}`, 9.5, "0.16 0.18 0.24", 10);
    else if (b.t === "table") table(b.head, b.rows);
  }
  pages.push(ops.join("\n"));

  /* assemble the PDF object graph */
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  const contentIds = pages.map(p => add(`<< /Length ${p.length} >>\nstream\n${p}\nendstream`));
  pages.forEach((_, i) => {
    pageIds.push(add(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`));
  });
  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  /* fix the parent references now that the Pages id is known */
  pageIds.forEach(id => {
    objects[id - 1] = objects[id - 1].replace("/Parent 0 0 R", `/Parent ${pagesId} 0 R`);
  });
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export const _internals = { blocksToPdf, wrapRuns, runs, escapePdfText };
