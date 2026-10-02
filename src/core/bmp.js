// Hand-written BMP codec: uncompressed indexed 1/4/8 bpp, bottom-up rows,
// BITMAPFILEHEADER (14B) + BITMAPINFOHEADER (40B) + BGRA palette.
import { bmpRowSize } from './params.js';
import { tileIndexed } from './seamless.js';

const PELS_PER_INCH_TO_METRE = 39.37;

/**
 * Encode indexed pixels (one palette index per byte) to a BMP file.
 * palette: [[r,g,b],...] (index 0 = background). The palette table is always
 * written in full (2^bpp entries, unused ones zeroed); biClrUsed = 0.
 * epi → biXPelsPerMeter, ppi → biYPelsPerMeter.
 */
export function encodeBmp({ indices, width: W, height: H, palette, bpp, epi = 80, ppi = 80 }) {
  if (![1, 4, 8].includes(bpp)) throw new Error(`Unsupported bpp: ${bpp}`);
  if (indices.length !== W * H) throw new Error('indices length does not match size');
  const entries = 1 << bpp;
  if (palette.length > entries) throw new Error(`Palette has ${palette.length} colours; ${bpp}-bpp allows ${entries}`);
  const rowSize = bmpRowSize(bpp, W);
  const dataOffset = 14 + 40 + entries * 4;
  const fileSize = dataOffset + rowSize * H;
  const buf = new Uint8Array(fileSize);
  const dv = new DataView(buf.buffer);

  buf[0] = 0x42; buf[1] = 0x4d;                 // 'BM'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, dataOffset, true);
  dv.setUint32(14, 40, true);                   // biSize
  dv.setInt32(18, W, true);
  dv.setInt32(22, H, true);                     // positive = bottom-up
  dv.setUint16(26, 1, true);                    // planes
  dv.setUint16(28, bpp, true);
  dv.setUint32(30, 0, true);                    // BI_RGB
  dv.setUint32(34, rowSize * H, true);
  dv.setInt32(38, Math.round(epi * PELS_PER_INCH_TO_METRE), true);
  dv.setInt32(42, Math.round(ppi * PELS_PER_INCH_TO_METRE), true);
  dv.setUint32(46, 0, true);                    // biClrUsed (0 = all)
  dv.setUint32(50, 0, true);                    // biClrImportant

  for (let i = 0; i < palette.length; i++) {    // BGRA
    const o = 54 + i * 4;
    buf[o] = palette[i][2]; buf[o + 1] = palette[i][1]; buf[o + 2] = palette[i][0]; buf[o + 3] = 0;
  }

  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W;                // bottom-up: first stored row = last image row
    const dst = dataOffset + y * rowSize;
    if (bpp === 8) {
      buf.set(indices.subarray(src, src + W), dst);
    } else if (bpp === 4) {
      for (let x = 0; x < W; x++) buf[dst + (x >> 1)] |= (indices[src + x] & 15) << (x & 1 ? 0 : 4);
    } else {
      for (let x = 0; x < W; x++) buf[dst + (x >> 3)] |= (indices[src + x] & 1) << (7 - (x & 7));
    }
  }
  return buf;
}

/**
 * Decode a BMP. Indexed 1/4/8 bpp returns { indices, palette }; 24/32 bpp
 * returns { rgba }. Handles top-down (negative height) files.
 */
export function decodeBmp(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('Not a BMP file');
  const offset = dv.getUint32(10, true);
  const hdr = dv.getUint32(14, true);
  if (hdr < 40) throw new Error('Unsupported BMP header');
  const W = dv.getInt32(18, true);
  let H = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const comp = dv.getUint32(30, true);
  if (comp !== 0) throw new Error('Compressed BMP not supported');
  const topDown = H < 0; if (topDown) H = -H;
  const rowSize = bmpRowSize(bpp, W);
  const out = {
    width: W, height: H, bpp, topDown,
    xPelsPerMeter: dv.getInt32(38, true), yPelsPerMeter: dv.getInt32(42, true),
  };
  const rowStart = (y) => offset + (topDown ? y : H - 1 - y) * rowSize;

  if (bpp <= 8) {
    const used = dv.getUint32(46, true) || 1 << bpp;
    out.palette = [];
    for (let i = 0; i < used; i++) {
      const o = 14 + hdr + i * 4;
      out.palette.push([buf[o + 2], buf[o + 1], buf[o]]);
    }
    out.indices = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = rowStart(y);
      for (let x = 0; x < W; x++) {
        out.indices[y * W + x] = bpp === 8 ? buf[r + x]
          : bpp === 4 ? (buf[r + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15
          : (buf[r + (x >> 3)] >> (7 - (x & 7))) & 1;
      }
    }
  } else if (bpp === 24 || bpp === 32) {
    const bytes = bpp / 8;
    out.rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const r = rowStart(y);
      for (let x = 0; x < W; x++) {
        const s = r + x * bytes, d = (y * W + x) * 4;
        out.rgba[d] = buf[s + 2]; out.rgba[d + 1] = buf[s + 1]; out.rgba[d + 2] = buf[s]; out.rgba[d + 3] = 255;
      }
    }
  } else throw new Error(`Unsupported bpp: ${bpp}`);
  return out;
}

/** design_{W}x{H}_{bpp}bpp.bmp */
export function exportFilename(W, H, bpp) {
  return `design_${W}x${H}_${bpp}bpp.bmp`;
}

/**
 * Build a BMP export. scope 'tile' = one tile; 'body' = tile repeated
 * hooks/tileWidth times across (the full-width body). Returns { bytes, filename, width, height, bpp }.
 */
export function exportBmp({ indices, W, H, palette, bpp, params, scope = 'tile' }) {
  let data = indices, width = W;
  if (scope === 'body') {
    const reps = params.hooks / W;
    if (!Number.isInteger(reps)) throw new Error(`hooks (${params.hooks}) is not a multiple of tile width (${W})`);
    data = tileIndexed(indices, W, H, reps, 1);
    width = W * reps;
  }
  const bytes = encodeBmp({ indices: data, width, height: H, palette, bpp, epi: params.epi, ppi: params.ppi });
  return { bytes, filename: exportFilename(width, H, bpp), width, height: H, bpp };
}
