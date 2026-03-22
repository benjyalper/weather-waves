/**
 * generate-icon.js
 *
 * Creates public/apple-touch-icon.png (180x180) at server start time.
 * Uses only Node.js built-ins (zlib + fs) — no extra npm packages.
 *
 * Design: deep-blue ocean background with two white wave crests.
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT  = path.join(__dirname, 'public', 'apple-touch-icon.png');
const W = 180, H = 180;

// ─── CRC-32 (required by PNG spec) ───────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const t   = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length);
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}

// ─── Pixel painter ───────────────────────────────────────────────────────────
function clamp(v) { return Math.min(255, Math.max(0, Math.round(v))); }

function getPixel(x, y) {
  const cx = x / (W - 1);   // 0..1
  const cy = y / (H - 1);   // 0..1

  // ── Base: ocean blue gradient (darker at bottom) ──
  let r = clamp(10  + cx * 15  - cy * 5);
  let g = clamp(80  + cx * 60  - cy * 20);
  let b = clamp(185 + cx * 40  - cy * 40);

  // ── Sky tint in the top quarter ──
  if (cy < 0.28) {
    const t = 1 - cy / 0.28;
    r = clamp(r + (100 - r) * t * 0.35);
    g = clamp(g + (160 - g) * t * 0.35);
    b = clamp(b + (220 - b) * t * 0.35);
  }

  // ── Wave 1 — wider, higher up ──
  const w1y = 0.46 + 0.09 * Math.sin(cx * Math.PI * 4);
  const d1  = Math.abs(cy - w1y);
  if (d1 < 0.055) {
    const blend = Math.pow(1 - d1 / 0.055, 1.6);
    // white foam at crest, aqua on shoulders
    if (d1 < 0.018) {
      r = clamp(r + (255 - r) * blend * 0.92);
      g = clamp(g + (255 - g) * blend * 0.92);
      b = clamp(b + (255 - b) * blend * 0.92);
    } else {
      r = clamp(r + (120 - r) * blend * 0.4);
      g = clamp(g + (200 - g) * blend * 0.4);
      b = clamp(b + (255 - b) * blend * 0.4);
    }
  }

  // ── Wave 2 — narrower, lower ──
  const w2y = 0.64 + 0.07 * Math.sin(cx * Math.PI * 4 + Math.PI);
  const d2  = Math.abs(cy - w2y);
  if (d2 < 0.045) {
    const blend = Math.pow(1 - d2 / 0.045, 1.6);
    if (d2 < 0.015) {
      r = clamp(r + (255 - r) * blend * 0.85);
      g = clamp(g + (255 - g) * blend * 0.85);
      b = clamp(b + (255 - b) * blend * 0.85);
    } else {
      r = clamp(r + (100 - r) * blend * 0.35);
      g = clamp(g + (190 - g) * blend * 0.35);
      b = clamp(b + (255 - b) * blend * 0.35);
    }
  }

  // ── Small sun in top-right ──
  const sx = 0.74, sy = 0.18, sr = 0.13;
  const sd = Math.sqrt((cx - sx) ** 2 + (cy - sy) ** 2);
  if (sd < sr) {
    const blend = Math.pow(1 - sd / sr, 1.4) * 0.88;
    r = clamp(r + (255 - r) * blend);
    g = clamp(g + (215 - g) * blend);
    b = clamp(b + (60  - b) * blend);
  }

  return [r, g, b];
}

// ─── Build PNG ────────────────────────────────────────────────────────────────
function buildPNG() {
  // Raw scanlines: 1 filter byte (0 = None) + W*3 RGB bytes per row
  const raw = Buffer.allocUnsafe(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = getPixel(x, y);
      const off = y * (1 + W * 3) + 1 + x * 3;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 2;  // colour type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ─── Write file ───────────────────────────────────────────────────────────────
const png = buildPNG();
fs.writeFileSync(OUT, png);
console.log(`Icon generated: ${OUT} (${png.length} bytes)`);
