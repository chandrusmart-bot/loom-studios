// Run-length scanning over 0/1 masks. Typed arrays, no DOM.

/**
 * Find runs of 1s in a mask.
 * axis 'weft' = horizontal runs per row, 'warp' = vertical runs per column.
 * cyclic wraps across the tile edge (a run may start near the end and continue
 * from index 0). Returns parallel arrays; positions along a run are
 * (start + i) % lineLength.
 */
export function findRuns(mask, W, H, axis, cyclic = false) {
  const weft = axis === 'weft';
  const lines = weft ? H : W;
  const n = weft ? W : H;
  const step = weft ? 1 : W;
  const lineStep = weft ? W : 1;
  const out = { axis, n, lines: [], starts: [], lens: [] };

  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let i = 0;
    // Cyclic: begin scanning at the first 0 so no run straddles the origin.
    let origin = 0;
    if (cyclic) {
      while (origin < n && mask[base + origin * step]) origin++;
      if (origin === n) { // whole line is one closed ring
        out.lines.push(l); out.starts.push(0); out.lens.push(n);
        continue;
      }
    }
    const total = cyclic ? n : n; // scan exactly n cells
    let runStart = -1;
    for (i = 0; i < total; i++) {
      const pos = cyclic ? (origin + i) % n : i;
      if (mask[base + pos * step]) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        out.lines.push(l);
        out.starts.push(cyclic ? (origin + runStart) % n : runStart);
        out.lens.push(i - runStart);
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      out.lines.push(l);
      out.starts.push(cyclic ? (origin + runStart) % n : runStart);
      out.lens.push(total - runStart);
    }
  }
  out.count = out.lens.length;
  return out;
}

/** Mask of pixels equal to colour c. */
export function colourMask(data, c) {
  const m = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) m[i] = data[i] === c ? 1 : 0;
  return m;
}

/** Binary pattern mask: 1 where pixel is not background (index 0). */
export function foregroundMask(data) {
  const m = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) m[i] = data[i] !== 0 ? 1 : 0;
  return m;
}
