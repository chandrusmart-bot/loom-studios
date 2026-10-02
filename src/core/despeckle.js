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
  const { areas } = labelBlobs(data, W, H, cyclic);
  let n = 0;
  for (const a of areas) if (a < minFeature) n++;
  return n;
}

/**
 * Recolour small blobs with the most common neighbouring colour (8-neighbour
 * border). Returns a new array; the input is untouched. Never introduces a
 * colour that is not already in the image.
 */
export function despeckle(data, W, H, minFeature = 2, cyclic = false) {
  const out = Uint8Array.from(data);
  if (minFeature <= 1) return out;
  const { labels, areas } = labelBlobs(data, W, H, cyclic);
  const votes = new Map();
  for (let p = 0; p < W * H; p++) {
    const id = labels[p];
    if (areas[id] >= minFeature) continue;
    const x = p % W, y = (p - x) / W;
    let v = votes.get(id);
    if (!v) votes.set(id, (v = new Map()));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        let nx = x + dx, ny = y + dy;
        if (cyclic) { nx = (nx + W) % W; ny = (ny + H) % H; }
        else if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (labels[q] !== id) v.set(data[q], (v.get(data[q]) || 0) + 1);
      }
    }
  }
  const pick = new Map();
  for (const [id, v] of votes) {
    let best = -1, bc = -1;
    for (const [c, n] of v) if (n > bc || (n === bc && c < best)) { bc = n; best = c; }
    if (best >= 0) pick.set(id, best);
  }
  for (let p = 0; p < W * H; p++) {
    const c = pick.get(labels[p]);
    if (c !== undefined && areas[labels[p]] < minFeature) out[p] = c;
  }
  return out;
}
