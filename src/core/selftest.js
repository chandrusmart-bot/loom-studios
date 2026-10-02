// Self-test suite. Runs in Node (wrapped by node:test) and in the browser
// (Self-test button). Synthetic data only: no file or network access.
import { encodeBmp, decodeBmp } from './bmp.js';
import { bmpRowSize, makeParams, bppForColours, bmpFileSize } from './params.js';
import { findRuns } from './runs.js';
import { analyze } from './analyze.js';
import { binderPlan, binderPositions, staggerOffset, fix } from './fixer.js';
import { validate, canExport } from './validator.js';
import { usedColours } from './quantize.js';
import { buildTile } from './pipeline.js';
import { checkSeamless } from './seamless.js';

function eq(a, b, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg); }

const PAL = [[255, 255, 255], [200, 0, 0], [0, 0, 200], [0, 150, 0]];

function syntheticRgba(W, H) {
  const out = new Uint8Array(W * H * 4);
  const cols = [[250, 250, 250], [200, 20, 20], [20, 20, 200], [20, 160, 40]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cols[(x < 8 || y < 8) ? 0 : x < W / 2 ? 1 : y < H / 2 ? 2 : 3];
    out.set([...c, 255], (y * W + x) * 4);
  }
  return out;
}

export const TESTS = [
  ['BMP header bytes', () => {
    const b = encodeBmp({ indices: new Uint8Array(120 * 4), width: 120, height: 4, palette: PAL, bpp: 4, epi: 80, ppi: 80 });
    const dv = new DataView(b.buffer);
    eq([b[0], b[1]], [0x42, 0x4d]);
    eq(dv.getUint32(14, true), 40, 'biSize');
    eq(dv.getInt32(18, true), 120, 'width');
    eq(dv.getInt32(22, true), 4, 'height (bottom-up positive)');
    eq(dv.getUint16(28, true), 4, 'bpp');
    eq(dv.getInt32(38, true), 3150, 'x pels');
    eq(b.length, bmpFileSize(4, 120, 4), 'file size');
  }],
  ['BMP row padding 1/4/8 bpp', () => {
    eq([1, 4, 8].map((b) => bmpRowSize(b, 33)), [8, 20, 36]);
    eq([1, 4, 8].map((b) => bmpRowSize(b, 120)), [16, 60, 120]);
  }],
  ['BMP round trip', () => {
    for (const [bpp, n] of [[1, 2], [4, 16], [8, 256]]) for (const W of [1, 9, 33]) {
      const idx = Uint8Array.from({ length: W * 4 }, (_, i) => (i * 7 + W) % n);
      const d = decodeBmp(encodeBmp({ indices: idx, width: W, height: 4, palette: PAL.slice(0, Math.min(n, 4)), bpp }));
      eq([...d.indices], [...idx], `bpp ${bpp} W ${W}`);
    }
  }],
  ['run-length counter incl. cyclic wrap', () => {
    const m = Uint8Array.from([1, 1, 0, 1, 1, 1]);
    eq(findRuns(m, 6, 1, 'weft', false).lens, [2, 3]);
    eq(findRuns(m, 6, 1, 'weft', true).lens, [5]);
    eq(findRuns(Uint8Array.from([1, 0, 1, 1]), 1, 4, 'warp', true).lens, [3]);
  }],
  ['binder spacing and stagger', () => {
    eq(binderPlan(15, 7), { n: 2, spacing: 5 });
    eq(staggerOffset(3, 2, 5), 1);
    for (let L = 8; L < 60; L++) {
      const pos = binderPositions(L, 7, 3, 2);
      let prev = -1;
      for (const p of pos) { ok(p - prev - 1 <= 7, `segment too long at L=${L}`); prev = p; }
      ok(L - prev - 1 <= 7, `tail too long at L=${L}`);
    }
  }],
  ['fix loop converges, colour count unchanged', () => {
    const W = 40, H = 30, d = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = x < 20 ? 1 : y < 15 ? 2 : 3;
    const r = fix(d, W, H, PAL, { lmax: 7, k: 2 });
    ok(r.before.violations > 0, 'fixture should start with violations');
    eq(r.after.violations, 0, 'violations after');
    eq(usedColours(r.data), usedColours(d), 'colour count');
    ok(r.passes.length <= 5, 'passes');
  }],
  ['fix keeps seamless edges', () => {
    const W = 32, H = 32;
    const d = Uint8Array.from({ length: W * H }, (_, i) => (i % W < 16 ? 1 : 2));
    for (let y = 0; y < H; y++) d[y * W + W - 1] = d[y * W];
    for (let x = 0; x < W; x++) d[(H - 1) * W + x] = d[x];
    const r = fix(d, W, H, PAL, { lmax: 7, cyclic: true, seamless: true });
    const s = checkSeamless(r.data, W, H);
    ok(s.lr && s.tb, 'seam broken by fix');
  }],
  ['validator gates', () => {
    const params = makeParams({ colours: 2 });
    const W = 120, H = 20;
    const good = Uint8Array.from({ length: W * H }, (_, i) => ((((i % W) >> 1) + (((i / W) | 0) >> 1)) % 2));
    ok(validate({ indices: good, W, H, params }).ok, 'good pattern should pass');
    const bad = Uint8Array.from(good); bad[0] = 2;
    const v = validate({ indices: bad, W, H, params });
    ok(!v.ok && !canExport(v) && canExport(v, true), 'colour overflow gate');
    ok(!validate({ indices: new Uint8Array(100 * 4), W: 100, H: 4, params }).ok, 'hook module / tile gate');
    ok(!validate({ indices: new Uint8Array(W * H).fill(1), W, H, params }).ok, 'float gate');
    eq(bppForColours(6), 4);
  }],
  ['pipeline: synthetic image -> valid tile', () => {
    const params = makeParams({ colours: 4 });
    const t = buildTile({ width: 64, height: 64, rgba: syntheticRgba(64, 64) }, params, { seamless: 'mirror' });
    eq([t.W, t.H], [120, 120]);
    ok(usedColours(t.indices) <= 4, 'colour limit');
    const s = checkSeamless(t.indices, t.W, t.H);
    ok(s.lr && s.tb, 'seamless edges');
  }],
  ['performance: analyze + fix 960x2000 < 2s', () => {
    const W = 960, H = 2000, d = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = Math.floor(x / 60 + y / 50) % 4;
    const t0 = performance.now();
    const r = fix(d, W, H, PAL, { lmax: 7, k: 2 });
    const ms = performance.now() - t0;
    ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
    return `${ms.toFixed(0)} ms, ${r.before.violations} -> ${r.after.violations} violations`;
  }],
];

export function runSelfTests() {
  return TESTS.map(([name, fn]) => {
    try { return { name, ok: true, info: fn() || '' }; }
    catch (e) { return { name, ok: false, error: e.message }; }
  });
}
