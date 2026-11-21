/* =====================================================================
   Minimal QR Code encoder (ISO/IEC 18004) — byte mode, error
   correction level M, versions 1–10. Written for the Partner
   Portal's "Your client link" QR card: no external dependency
   (the repo carries only @vercel/blob), output is a module matrix
   rendered to SVG by qrSvg().

   Correctness is not asserted by this comment: at build time
   (2026-11-21) this encoder's matrices were compared
   module-by-module against the python-qrcode reference encoder
   — byte-identical for every mask on version-1 and version-3
   payloads — and rendered outputs were decoded back to the
   exact payloads by OpenCV's QR detectors. The node test suite
   (scripts/partner-portal.test.mjs) re-checks the format
   information, Reed–Solomon syndromes and data round-trip.
   ===================================================================== */

/* ---- GF(256) arithmetic, primitive polynomial 0x11D ---- */
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a, b) => (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;

/* Reed–Solomon generator polynomial of the given degree:
   ∏(x − α^i) for i = 0..degree−1, coefficients in descending
   powers, leading coefficient 1. */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const r = GF_EXP[i];
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], r);
    }
    poly = next;
  }
  return poly;
}

/* ECC bytes for one data block. */
function rsEncode(data, eccLen) {
  const gen = rsGenerator(eccLen);
  const res = new Array(eccLen).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift();
    res.push(0);
    for (let i = 0; i < eccLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

/* ---- Version table, ECC level M ----
   [totalCodewords, eccPerBlock, [[blockCount, dataCwPerBlock], ...],
    alignmentCenters, remainderBits]                          */
const VERSIONS_M = {
  1: [26, 10, [[1, 16]], [], 0],
  2: [44, 16, [[1, 28]], [6, 18], 7],
  3: [70, 26, [[1, 44]], [6, 22], 7],
  4: [100, 18, [[2, 32]], [6, 26], 7],
  5: [134, 24, [[2, 43]], [6, 30], 7],
  6: [172, 16, [[4, 27]], [6, 34], 7],
  7: [196, 18, [[4, 31]], [6, 22, 38], 0],
  8: [242, 22, [[2, 38], [2, 39]], [6, 24, 42], 0],
  9: [292, 22, [[3, 36], [2, 37]], [6, 26, 46], 0],
  10: [346, 26, [[4, 43], [1, 44]], [6, 28, 50], 2]
};

function dataCapacity(version) {
  const [, , groups] = VERSIONS_M[version];
  return groups.reduce((n, [count, cw]) => n + count * cw, 0);
}

/* Encode the payload into the final interleaved codeword list. */
function buildCodewords(bytes) {
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (headerBits + bytes.length * 8 <= dataCapacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error('qr_payload_too_long');
  const capacity = dataCapacity(version);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);                       /* byte mode */
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capBits = capacity * 8;
  push(0, Math.min(4, capBits - bits.length));           /* terminator */
  while (bits.length % 8) bits.push(0);
  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataBytes.push(b);
  }
  for (let pad = 0xEC; dataBytes.length < capacity; pad = pad === 0xEC ? 0x11 : 0xEC) {
    dataBytes.push(pad);
  }
  /* Split into blocks, ECC each, interleave data then ECC. */
  const [, eccLen, groups] = VERSIONS_M[version];
  const blocks = [];
  let off = 0;
  for (const [count, cw] of groups) {
    for (let i = 0; i < count; i++) {
      const block = dataBytes.slice(off, off + cw);
      off += cw;
      blocks.push({ data: block, ecc: rsEncode(block, eccLen) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.ecc[i]);
  return { version, codewords: out };
}

/* ---- Matrix construction ---- */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function formatBits(mask) {
  const data = (0b00 << 3) | mask;              /* ECC level M = 00 */
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0x537 : 0);
  return (((data << 10) | (rem & 0x3FF)) ^ 0x5412) & 0x7FFF;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >> 11) & 1) ? 0x1F25 : 0);
  return ((version << 12) | (rem & 0xFFF)) & 0x3FFFF;
}

function buildMatrix(version, codewords, mask) {
  const size = 17 + version * 4;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

  /* Finder patterns + separators. */
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inCore = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inCore && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      set(r0 + r, c0 + c, dark ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  /* Timing patterns. */
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  /* Alignment patterns. */
  const centers = VERSIONS_M[version][3];
  for (const r of centers) for (const c of centers) {
    if (m[r][c] !== null) continue;              /* overlaps a finder */
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      set(r + dr, c + dc, (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0);
    }
  }

  /* Reserve format-information areas + dark module. */
  for (let i = 0; i < 9; i++) { if (m[8][i] === null) m[8][i] = 0; if (m[i][8] === null) m[i][8] = 0; }
  for (let i = 0; i < 8; i++) { if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0; if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0; }
  m[size - 8][8] = 1;                            /* dark module */

  /* Reserve version-information areas (version 7+). */
  if (version >= 7) {
    for (let r = 0; r < 6; r++) for (let c = size - 11; c < size - 8; c++) if (m[r][c] === null) m[r][c] = 0;
    for (let r = size - 11; r < size - 8; r++) for (let c = 0; c < 6; c++) if (m[r][c] === null) m[r][c] = 0;
  }

  /* Place data bits (zigzag from bottom-right), applying the mask
     to data modules only. */
  const bits = [];
  for (const b of codewords) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  for (let i = 0; i < VERSIONS_M[version][4]; i++) bits.push(0);
  let bit = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;                      /* skip timing column */
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (m[row][c] === null) {
          let v = bit < bits.length ? bits[bit++] : 0;
          if (MASKS[mask](row, c)) v ^= 1;
          m[row][c] = v;
        }
      }
    }
    upward = !upward;
  }

  /* Format information — the 15-bit value is placed MSB-first
     along both strips (verified module-by-module against the
     python-qrcode reference encoder). */
  const fb = formatBits(mask);
  const fbit = i => (fb >>> i) & 1;
  for (let i = 0; i <= 5; i++) m[8][i] = fbit(14 - i);
  m[8][7] = fbit(8); m[8][8] = fbit(7); m[7][8] = fbit(6);
  for (let i = 9; i < 15; i++) m[14 - i][8] = fbit(14 - i);
  for (let i = 0; i < 7; i++) m[size - 1 - i][8] = fbit(14 - i);
  m[8][size - 8] = fbit(7);
  for (let j = 0; j < 7; j++) m[8][size - 7 + j] = fbit(6 - j);
  m[size - 8][8] = 1;                            /* dark module */

  /* Version information. */
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const v = (vb >>> i) & 1;
      m[Math.floor(i / 3)][size - 11 + (i % 3)] = v;
      m[size - 11 + (i % 3)][Math.floor(i / 3)] = v;
    }
  }
  return m;
}

/* Penalty score (mask evaluation, ISO rules 1–4, simplified
   run-history rule per the spec's N1/N2/N3/N4 weights). */
function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map(r => r[i])); }
  for (const line of lines) {
    let runColor = line[0], runLen = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === runColor) { runLen++; continue; }
      if (runLen >= 5) score += 3 + (runLen - 5);
      runColor = line[i]; runLen = 1;
    }
    /* Rule 3: finder-like patterns 10111010000 / 00001011101. */
    const s = line.join('');
    for (let i = 0; i + 11 <= size; i++) {
      const w = s.slice(i, i + 11);
      if (w === '10111010000' || w === '00001011101') score += 40;
    }
  }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v === 1) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/* Encode text to a QR module matrix (array of rows of 0/1),
   choosing the lowest-penalty mask. Throws on over-length input. */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  const { version, codewords } = buildCodewords(bytes);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = buildMatrix(version, codewords, mask);
    const p = penalty(m);
    if (!best || p < best.penalty) best = { matrix: m, penalty: p, version, mask };
  }
  return best;
}

/* Render a matrix to a standalone SVG string (4-module quiet zone). */
export function qrSvg(text, { module = 6, fg = '#0E2A47', bg = '#FFFFFF' } = {}) {
  const { matrix } = qrMatrix(text);
  const size = matrix.length;
  const q = 4;
  const dim = (size + q * 2) * module;
  let d = '';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (matrix[r][c] === 1) d += `M${(c + q) * module} ${(r + q) * module}h${module}v${module}h-${module}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" role="img" aria-label="QR code"><rect width="${dim}" height="${dim}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

export const _internals = { buildCodewords, buildMatrix, formatBits, versionBits, rsEncode, dataCapacity, VERSIONS_M };
