// Remove blobs (4-connected, same index) smaller than a minimum area.

/** Label blobs; returns { labels:Int32Array, areas:number[], colours:number[] }. */
export function labelBlobs(data, W, H, cyclic = false) {
  const labels = new Int32Array(W * H).fill(-1);
  const areas = [], colours = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (labels[s] >= 0) continue;
    const id = areas.length, c = data[s];
    let sp = 0, area = 0;
    stack[sp++] = s; labels[s] = id;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % W, y = (p - x) / W;
      const nb = [];
      if (x > 0) nb.push(p - 1); else if (cyclic) nb.push(p + W - 1);
      if (x < W - 1) nb.push(p + 1); else if (cyclic) nb.push(p - W + 1);
      if (y > 0) nb.push(p - W); else if (cyclic) nb.push(p + (H - 1) * W);
      if (y < H - 1) nb.push(p + W); else if (cyclic) nb.push(p - (H - 1) * W);
      for (const q of nb) if (labels[q] < 0 && data[q] === c) { labels[q] = id; stack[sp++] = q; }
    }
    areas.push(area); colours.push(c);
  }
  return { labels, areas, colours };
}

/** Count blobs with area < minFeature. */
export function countSmallBlobs(data, W, H, minFeature, cyclic = false) {
  return smallBlobStats(data, W, H, minFeature, cyclic).total;
}

/**
 * Small-blob stats. With `binderMask` (1 = pixel edited by the fixer), blobs
 * that contain or touch (8-neighbour) a binder pixel are counted as
 * `binderCaused` instead of `total`: a single-pixel binder inside a solid area
 * is a 1px blob by construction.
 */
export function smallBlobStats(data, W, H, minFeature, cyclic = false, binderMask = null) {
  const { labels, areas } = labelBlobs(data, W, H, cyclic);
  const caused = new Uint8Array(areas.length);
  if (binderMask) {
    for (let p = 0; p < W * H; p++) {
      if (!binderMask[p]) continue;
      const x = p % W, y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let nx = x + dx, ny = y + dy;
        if (cyclic) { nx = (nx + W) % W; ny = (ny + H) % H; }
        else if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        caused[labels[ny * W + nx]] = 1;
      }
    }
  }
  let total = 0, binderCaused = 0;
  for (let i = 0; i < areas.length; i++) {
    if (areas[i] >= minFeature) continue;
    if (caused[i]) binderCaused++; else total++;
  }
  return { total, binderCaused };
}

/**
 * Recolour small blobs with the most common neighbouring colour (8-neighbour
 * border). Blobs are merged one at a time against the current state (so two
 * touching specks cannot swap colours), repeating until none remain or
 * `maxPasses` is hit. Returns a new array; the input is untouched. Never
 * introduces a colour that is not already in the image.
 */
export function despeckle(data, W, H, minFeature = 2, cyclic = false, maxPasses = 8) {
  const out = Uint8Array.from(data);
  if (minFeature <= 1) return out;
  for (let pass = 0; pass < maxPasses; pass++) {
    const { labels, areas } = labelBlobs(out, W, H, cyclic);
    const members = new Map();
    for (let p = 0; p < W * H; p++) {
      if (areas[labels[p]] >= minFeature) continue;
      let m = members.get(labels[p]);
      if (!m) members.set(labels[p], (m = []));
      m.push(p);
    }
    if (!members.size) break;
    for (const [id, pixels] of members) {
      const votes = new Map();
      for (const p of pixels) {
        const x = p % W, y = (p - x) / W;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let nx = x + dx, ny = y + dy;
          if (cyclic) { nx = (nx + W) % W; ny = (ny + H) % H; }
          else if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (labels[q] === id) continue;
          votes.set(out[q], (votes.get(out[q]) || 0) + 1);
        }
      }
      let best = -1, bc = -1;
      for (const [c, n] of votes) if (n > bc || (n === bc && c < best)) { bc = n; best = c; }
      if (best >= 0) for (const p of pixels) out[p] = best;
    }
  }
  return out;
}
