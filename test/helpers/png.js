// Test-only PNG decoder (8-bit, non-interlaced, colour types 0/2/3/4/6). Returns RGBA.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  let pos = 8, w, h, depth, ctype, interlace;
  const idat = []; let plte = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === 'PLTE') plte = body;
    else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('unsupported PNG');
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[dst + i - bpp] : 0;
      const b = y ? px[dst - stride + i] : 0;
      const c = i >= bpp && y ? px[dst - stride + i - bpp] : 0;
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[dst + i] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp, d = i * 4;
    if (ctype === 6) { rgba.set(px.subarray(s, s + 4), d); }
    else if (ctype === 2) { rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = 255; }
    else if (ctype === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = 255; }
    else if (ctype === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = px[s]; rgba[d + 3] = px[s + 1]; }
    else { const k = px[s] * 3; rgba[d] = plte[k]; rgba[d + 1] = plte[k + 1]; rgba[d + 2] = plte[k + 2]; rgba[d + 3] = 255; }
  }
  return { width: w, height: h, rgba };
}
