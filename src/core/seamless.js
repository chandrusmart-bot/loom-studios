// Seamless-tile helpers. `ch` = channels per pixel (4 for RGBA, 1 for indexed).

/** Symmetric cross-fade of the outer `band` pixels so opposite edges meet. */
export function edgeBlend(src, W, H, band, ch = 4, axes = { x: true, y: true }) {
  const out = Float32Array.from(src);
  const mix = (a, b, t) => { // blend pixel a toward pixel b
    for (let c = 0; c < ch; c++) {
      const A = src[a * ch + c], B = src[b * ch + c];
      out[a * ch + c] = A * (1 - t) + B * t;
    }
  };
  if (axes.x) {
    const b = Math.min(band, Math.floor(W / 2));
    for (let y = 0; y < H; y++) for (let i = 0; i < b; i++) {
      const t = 0.5 * (1 - i / b), l = y * W + i, r = y * W + W - 1 - i;
      mix(l, r, t); mix(r, l, t);
    }
  }
  if (axes.y) {
    const b = Math.min(band, Math.floor(H / 2));
    // vertical pass reads the horizontally blended result
    const base = Float32Array.from(out);
    for (let x = 0; x < W; x++) for (let i = 0; i < b; i++) {
      const t = 0.5 * (1 - i / b), tp = i * W + x, bt = (H - 1 - i) * W + x;
      for (let c = 0; c < ch; c++) {
        const A = base[tp * ch + c], B = base[bt * ch + c];
        out[tp * ch + c] = A * (1 - t) + B * t;
        out[bt * ch + c] = B * (1 - t) + A * t;
      }
    }
  }
  const res = new Uint8Array(src.length);
  for (let i = 0; i < res.length; i++) res[i] = Math.round(out[i]);
  return res;
}

/** Reflect the left half over the right (and top over bottom): symmetric, so edges match. */
export function mirror(src, W, H, ch = 4, axes = { x: true, y: true }) {
  const out = Uint8Array.from(src);
  if (axes.x) for (let y = 0; y < H; y++) for (let x = Math.ceil(W / 2); x < W; x++) {
    for (let c = 0; c < ch; c++) out[(y * W + x) * ch + c] = out[(y * W + (W - 1 - x)) * ch + c];
  }
  if (axes.y) for (let y = Math.ceil(H / 2); y < H; y++) for (let x = 0; x < W; x++) {
    for (let c = 0; c < ch; c++) out[(y * W + x) * ch + c] = out[((H - 1 - y) * W + x) * ch + c];
  }
  return out;
}

/** Force opposite edges of an indexed tile to be identical (last col/row := first). */
export function enforceSeam(data, W, H, axes = { x: true, y: true }) {
  const out = Uint8Array.from(data);
  if (axes.x) for (let y = 0; y < H; y++) out[y * W + W - 1] = out[y * W];
  if (axes.y) for (let x = 0; x < W; x++) out[(H - 1) * W + x] = out[x];
  return out;
}

/** Edge match report for an indexed tile. */
export function checkSeamless(data, W, H) {
  let lr = 0, tb = 0;
  for (let y = 0; y < H; y++) if (data[y * W] !== data[y * W + W - 1]) lr++;
  for (let x = 0; x < W; x++) if (data[x] !== data[(H - 1) * W + x]) tb++;
  return { lrMismatch: lr, tbMismatch: tb, lr: lr === 0, tb: tb === 0 };
}

/** Tile an indexed image nx × ny (for 3x3 preview and the full-hook body). */
export function tileIndexed(data, W, H, nx, ny) {
  const out = new Uint8Array(W * nx * H * ny);
  const OW = W * nx;
  for (let y = 0; y < H * ny; y++) {
    const row = (y % H) * W;
    for (let tx = 0; tx < nx; tx++) out.set(data.subarray(row, row + W), y * OW + tx * W);
  }
  return out;
}
