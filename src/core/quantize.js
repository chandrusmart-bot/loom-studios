// Median-cut quantizer producing an indexed image. Index 0 = background.

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function key15(r, g, b) {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

function nearest(palette, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Median-cut palette of up to n colours from RGBA pixels (alpha ignored). */
export function medianCutPalette(rgba, n) {
  const count = new Uint32Array(32768);
  const sum = new Float64Array(32768 * 3);
  for (let i = 0; i < rgba.length; i += 4) {
    const k = key15(rgba[i], rgba[i + 1], rgba[i + 2]);
    count[k]++;
    sum[k * 3] += rgba[i]; sum[k * 3 + 1] += rgba[i + 1]; sum[k * 3 + 2] += rgba[i + 2];
  }
  const items = [];
  for (let k = 0; k < 32768; k++) {
    if (count[k]) items.push({ c: count[k], r: sum[k * 3] / count[k], g: sum[k * 3 + 1] / count[k], b: sum[k * 3 + 2] / count[k] });
  }
  if (!items.length) return [];
  const boxes = [items];
  const range = (box) => {
    let lo = [255, 255, 255], hi = [0, 0, 0];
    for (const it of box) {
      const v = [it.r, it.g, it.b];
      for (let a = 0; a < 3; a++) { if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; }
    }
    const sp = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = sp[0] >= sp[1] && sp[0] >= sp[2] ? 0 : sp[1] >= sp[2] ? 1 : 2;
    return { axis, spread: sp[axis] };
  };
  while (boxes.length < n) {
    // split the splittable box with the largest population * spread
    let bi = -1, bs = 0, baxis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { axis, spread } = range(box);
      const pop = box.reduce((s, it) => s + it.c, 0);
      const score = pop * (spread + 1);
      if (spread > 0 && score > bs) { bs = score; bi = i; baxis = axis; }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    const ch = ['r', 'g', 'b'][baxis];
    box.sort((a, b) => a[ch] - b[ch]);
    const total = box.reduce((s, it) => s + it.c, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].c; cut = i + 1;
      if (acc >= total / 2) break;
    }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    const pop = box.reduce((s, it) => s + it.c, 0);
    return [
      Math.round(box.reduce((s, it) => s + it.r * it.c, 0) / pop),
      Math.round(box.reduce((s, it) => s + it.g * it.c, 0) / pop),
      Math.round(box.reduce((s, it) => s + it.b * it.c, 0) / pop),
    ];
  });
}

/** Palette index that dominates the image border (default background guess). */
function borderDominant(indices, W, H, size) {
  const cnt = new Uint32Array(size);
  for (let x = 0; x < W; x++) { cnt[indices[x]]++; cnt[indices[(H - 1) * W + x]]++; }
  for (let y = 0; y < H; y++) { cnt[indices[y * W]]++; cnt[indices[y * W + W - 1]]++; }
  let best = 0;
  for (let i = 1; i < size; i++) if (cnt[i] > cnt[best]) best = i;
  return best;
}

/** Reorder so `bg` becomes index 0 and the rest sort by population (desc). */
function reorder(indices, palette, bg) {
  const pop = new Uint32Array(palette.length);
  for (let i = 0; i < indices.length; i++) pop[indices[i]]++;
  const order = palette.map((_, i) => i).filter((i) => i !== bg);
  order.sort((a, b) => pop[b] - pop[a]);
  order.unshift(bg);
  const remap = new Uint8Array(palette.length);
  order.forEach((old, ni) => { remap[old] = ni; });
  const out = new Uint8Array(indices.length);
  for (let i = 0; i < indices.length; i++) out[i] = remap[indices[i]];
  return { indices: out, palette: order.map((o) => palette[o]) };
}

/**
 * Quantize RGBA to `n` colours total (background included).
 * opts: dither ('none'|'ordered'), background ([r,g,b] forces index 0 colour).
 */
export function quantize(rgba, W, H, n, opts = {}) {
  if (!(n >= 1)) throw new Error('Colour count must be at least 1');
  n = Math.min(256, Math.floor(n));
  let palette = medianCutPalette(rgba, n);
  if (!palette.length) throw new Error('Image has no pixels');
  if (opts.background) {
    const bgc = opts.background;
    let bi = nearest(palette, bgc[0], bgc[1], bgc[2]);
    palette = palette.slice();
    palette[bi] = bgc.slice(0, 3);
  }
  const indices = new Uint8Array(W * H);
  const ordered = opts.dither === 'ordered';
  const cache = new Int16Array(32768).fill(-1);
  const spread = 255 / Math.max(2, Math.cbrt(palette.length)) * 0.5;
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p++) {
      let r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2];
      if (ordered) {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * spread;
        indices[p] = nearest(palette, Math.max(0, Math.min(255, r + t)), Math.max(0, Math.min(255, g + t)), Math.max(0, Math.min(255, b + t)));
      } else {
        const k = key15(r, g, b);
        if (cache[k] < 0) cache[k] = nearest(palette, r, g, b);
        indices[p] = cache[k];
      }
    }
  }
  const bg = opts.background ? nearest(palette, ...opts.background) : borderDominant(indices, W, H, palette.length);
  return reorder(indices, palette, bg);
}

export function usedColours(indices) {
  const seen = new Uint8Array(256);
  for (let i = 0; i < indices.length; i++) seen[indices[i]] = 1;
  let n = 0;
  for (let i = 0; i < 256; i++) n += seen[i];
  return n;
}

/** Drop palette entries nobody uses (keeping index 0) and renumber. */
export function compactPalette(indices, palette) {
  const used = new Uint8Array(palette.length);
  used[0] = 1;
  for (let i = 0; i < indices.length; i++) used[indices[i]] = 1;
  const remap = new Uint8Array(palette.length);
  const np = [];
  for (let i = 0; i < palette.length; i++) if (used[i]) { remap[i] = np.length; np.push(palette[i]); }
  const out = new Uint8Array(indices.length);
  for (let i = 0; i < indices.length; i++) out[i] = remap[indices[i]];
  return { indices: out, palette: np };
}

/** Merge colour `from` into `into`; returns compacted result. */
export function mergeColours(indices, palette, from, into) {
  if (from === into) return { indices, palette };
  if (from === 0) { const t = from; from = into; into = t; } // never delete background slot
  const out = Uint8Array.from(indices);
  for (let i = 0; i < out.length; i++) if (out[i] === from) out[i] = into;
  return compactPalette(out, palette);
}

export function setPaletteColour(palette, i, rgb) {
  const np = palette.map((c) => c.slice());
  np[i] = [rgb[0], rgb[1], rgb[2]];
  return np;
}

/** Swap palette slots a and b (used to make a colour the background, index 0). */
export function swapColours(indices, palette, a, b) {
  const out = Uint8Array.from(indices);
  for (let i = 0; i < out.length; i++) if (out[i] === a) out[i] = b; else if (out[i] === b) out[i] = a;
  const np = palette.map((c) => c.slice());
  [np[a], np[b]] = [np[b], np[a]];
  return { indices: out, palette: np };
}
