// Float analysis: weft (horizontal) and warp (vertical) run metrics.
import { findRuns, colourMask, foregroundMask } from './runs.js';

export const HEAT = Object.freeze({ NONE: 0, OK: 1, NEAR: 2, VIOLATION: 3 });

function metricsFor(runs, lmax, W, H) {
  const hist = {};
  let max = 0, sum = 0, violations = 0, excess = 0, violPixels = 0;
  for (const L of runs.lens) {
    hist[L] = (hist[L] || 0) + 1;
    sum += L;
    if (L > max) max = L;
    if (L > lmax) { violations++; excess += L - lmax; violPixels += L; }
  }
  return {
    runs: runs.count,
    maxFloat: max,
    avgFloat: runs.count ? sum / runs.count : 0,
    violations,
    excess,
    densityPct: (violPixels / (W * H)) * 100,
    histogram: hist,
  };
}

function nearThreshold(lmax) {
  return Math.max(1, Math.ceil(lmax * 0.75));
}

/**
 * Analyze an indexed image.
 * opts: lmax, cyclic (wrap across tile edges), countBackground (index 0 runs
 * count toward violations; default false).
 * Violations and heatmaps come from per-colour masks. The combined binary
 * pattern (foreground = index != 0) is reported separately in `binary`.
 */
export function analyze(data, W, H, opts) {
  const { lmax, cyclic = false, countBackground = false } = opts;
  let present = new Uint8Array(256);
  for (let i = 0; i < data.length; i++) present[data[i]] = 1;
  const colours = [];
  for (let c = 0; c < 256; c++) if (present[c]) colours.push(c);

  const near = nearThreshold(lmax);
  const res = { W, H, lmax, cyclic, colours, violatingRuns: [], heat: {} };
  const unionViolation = new Uint8Array(W * H);

  const axes = ['weft', 'warp'];
  const acc = {};
  for (const axis of axes) acc[axis] = { heat: new Uint8Array(W * H), perColour: {}, counted: { lens: [], count: 0 } };
  for (const c of colours) {
    const mask = colourMask(data, c); // one mask serves both axes
    for (const axis of axes) {
      const { heat, perColour, counted } = acc[axis];
      const runs = findRuns(mask, W, H, axis, cyclic);
      perColour[c] = metricsFor(runs, lmax, W, H);
      if (c === 0 && !countBackground) continue;
      for (let r = 0; r < runs.count; r++) {
        const L = runs.lens[r];
        counted.lens.push(L); counted.count++;
        const level = L > lmax ? HEAT.VIOLATION : L >= near ? HEAT.NEAR : HEAT.OK;
        const line = runs.lines[r], start = runs.starts[r], n = runs.n;
        for (let i = 0; i < L; i++) {
          let pos = start + i; if (pos >= n) pos -= n;
          const p = axis === 'weft' ? line * W + pos : pos * W + line;
          heat[p] = level;
          if (level === HEAT.VIOLATION) unionViolation[p] = 1;
        }
        if (level === HEAT.VIOLATION) res.violatingRuns.push({ axis, line, start, len: L, colour: c });
      }
    }
  }
  for (const axis of axes) {
    res[axis] = { ...metricsFor(acc[axis].counted, lmax, W, H), perColour: acc[axis].perColour };
    res.heat[axis] = acc[axis].heat;
  }

  const binary = {};
  for (const axis of ['weft', 'warp']) {
    binary[axis] = metricsFor(findRuns(foregroundMask(data), W, H, axis, cyclic), lmax, W, H);
  }
  res.binary = binary;

  let up = 0;
  for (let i = 0; i < unionViolation.length; i++) up += unionViolation[i];
  res.violations = res.weft.violations + res.warp.violations;
  res.excess = res.weft.excess + res.warp.excess;
  res.maxFloat = Math.max(res.weft.maxFloat, res.warp.maxFloat);
  res.avgFloat = (res.weft.avgFloat * res.weft.runs + res.warp.avgFloat * res.warp.runs) / Math.max(1, res.weft.runs + res.warp.runs);
  res.densityPct = (up / (W * H)) * 100;
  return res;
}

/** Compact summary for before/after diffs and reports. */
export function summarize(a) {
  return {
    violations: a.violations, weftViolations: a.weft.violations, warpViolations: a.warp.violations,
    excess: a.excess, maxFloat: a.maxFloat, avgFloat: +a.avgFloat.toFixed(3),
    densityPct: +a.densityPct.toFixed(3),
  };
}
