// Auto-fix: break long floats with staggered single-pixel binders.
import { analyze } from './analyze.js';

/** Number of binders and nominal spacing for a run of length L. */
export function binderPlan(L, lmax) {
  const n = Math.ceil(L / lmax) - 1;
  return { n, spacing: n > 0 ? L / (n + 1) : L };
}

/** Stagger offset for adjacent line x: (x * k) mod s (s may be fractional). */
export function staggerOffset(x, k, s) {
  const v = (x * k) % s;
  return v < 0 ? v + s : v;
}

/**
 * Binder positions (0-based offsets inside a run of length L) for a run on
 * line index `line`. Every resulting segment is <= lmax. The first segment is
 * shifted by the stagger offset (clamped to what keeps all segments legal);
 * remaining segments are balanced.
 */
export function binderPositions(L, lmax, line, k) {
  const { n, spacing } = binderPlan(L, lmax);
  if (n <= 0) return [];
  const free = L - n; // pixels left for the n+1 segments
  const even = free / (n + 1);
  const delta = Math.round(staggerOffset(line, k, spacing) - spacing / 2);
  const lo = Math.max(1, free - n * lmax);
  const hi = Math.min(lmax, free - n); // leave >=1 for each other segment
  let d0 = Math.max(lo, Math.min(hi, Math.round(even) + delta));
  const segs = [d0];
  let rem = free - d0;
  for (let i = 1; i <= n; i++) {
    const left = n + 1 - i; // segments still to place including this one
    const v = Math.ceil(rem / left);
    segs.push(v); rem -= v;
  }
  const pos = [];
  let at = 0;
  for (let i = 0; i < n; i++) { at += segs[i]; pos.push(at); at += 1; }
  return pos;
}

function dist2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/**
 * One fixing pass over the violating runs of `a` (an analysis of `data`).
 * Mutates `data`. Returns the number of binders placed.
 */
function fixPass(data, W, H, palette, a, k, usedSet, opts) {
  const { lmax, cyclic, seamless } = opts;
  let placed = 0;
  const wrap = (v, n) => ((v % n) + n) % n;

  for (const run of a.violatingRuns) {
    const weft = run.axis === 'weft';
    const n = weft ? W : H;
    const L = run.len;
    // the run may have been shortened by an earlier binder this pass
    const pos = binderPositions(L, lmax, run.line, k);
    const toXY = (i) => {
      const t = wrap(run.start + i, n);
      return weft ? [t, run.line] : [run.line, t];
    };
    for (const p of pos) {
      const [x, y] = toXY(p);
      const idx = y * W + x;
      if (data[idx] !== run.colour) continue; // changed by an earlier fix
      // perpendicular neighbours (adjacent lines, same position)
      const nbrs = weft ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]];
      const cands = new Map();
      for (let [nx, ny] of nbrs) {
        if (cyclic) { nx = wrap(nx, W); ny = wrap(ny, H); }
        else if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const c = data[ny * W + nx];
        if (c !== run.colour) cands.set(c, true);
      }
      if (!cands.size) for (const c of usedSet) if (c !== run.colour) cands.set(c, true);
      if (!cands.size) continue;
      // perpendicular run length candidate would join (to avoid new floats)
      const joinLen = (c) => {
        let len = 1;
        for (const dir of [-1, 1]) {
          for (let s = 1; s < (weft ? H : W); s++) {
            let cx = weft ? x : x + dir * s, cy = weft ? y + dir * s : y;
            if (cyclic) { cx = wrap(cx, W); cy = wrap(cy, H); }
            else if (cx < 0 || cy < 0 || cx >= W || cy >= H) break;
            if (data[cy * W + cx] !== c) break;
            len++;
          }
        }
        return len;
      };
      let best = -1, bs = Infinity;
      for (const c of cands.keys()) {
        const over = joinLen(c) > lmax ? 1 : 0;
        const score = over * 1e9 + dist2(palette[c], palette[run.colour]);
        if (score < bs) { bs = score; best = c; }
      }
      data[idx] = best; placed++;
      if (seamless) { // keep opposite edges identical: edit both mirrored pixels
        const px = x === 0 ? W - 1 : x === W - 1 ? 0 : x, py = y === 0 ? H - 1 : y === H - 1 ? 0 : y;
        data[y * W + px] = best; data[py * W + x] = best; data[py * W + px] = best;
      }
    }
  }
  return placed;
}

/**
 * Fix loop: analyze, place binders, re-validate; up to maxPasses passes.
 * Only colours already in the image are used, so the colour count can never
 * grow. Dimensions are untouched (hook alignment preserved). With `seamless`
 * on, edge pixels are edited together with their mirrored partners so L/R and
 * T/B edges stay equal.
 */
export function fix(input, W, H, palette, opts) {
  const { lmax, k = 2, cyclic = false, seamless = cyclic, countBackground = false, maxPasses = 5 } = opts;
  const data = Uint8Array.from(input);
  const used = new Set(data);
  const passes = [];
  let a = analyze(data, W, H, { lmax, cyclic, countBackground });
  const initial = a;
  let binders = 0;
  for (let p = 1; p <= maxPasses && a.violations > 0; p++) {
    const placed = fixPass(data, W, H, palette, a, k, used, { lmax, cyclic, seamless });
    binders += placed;
    a = analyze(data, W, H, { lmax, cyclic, countBackground });
    passes.push({ pass: p, binders: placed, violations: a.violations, excess: a.excess });
    if (!placed) break;
  }
  const binderMask = new Uint8Array(data.length); // pixels the fixer edited
  for (let i = 0; i < data.length; i++) binderMask[i] = data[i] !== input[i] ? 1 : 0;
  return { data, binderMask, before: initial, after: a, passes, binders, converged: a.violations === 0 };
}
