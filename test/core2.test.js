import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { decodePng } from './helpers/png.js';
import { makeParams, correctedHeight } from '../src/core/params.js';
import { analyze, HEAT } from '../src/core/analyze.js';
import { binderPlan, binderPositions, staggerOffset, fix } from '../src/core/fixer.js';
import { validate, canExport } from '../src/core/validator.js';
import { quantize, usedColours } from '../src/core/quantize.js';
import { resize, flattenAlpha } from '../src/core/resize.js';
import { despeckle } from '../src/core/despeckle.js';
import { enforceSeam } from '../src/core/seamless.js';

const PAL = [[255, 255, 255], [200, 0, 0], [0, 0, 200], [0, 150, 0]];

test('analyze: metrics on a known row', () => {
  // W=10,H=2 ; row0: colour1 x9 then 0 ; row1 all 0
  const W = 10, H = 2, d = new Uint8Array(W * H);
  d.fill(1, 0, 9);
  const a = analyze(d, W, H, { lmax: 7 });
  assert.equal(a.weft.violations, 1);
  assert.equal(a.weft.excess, 2);
  assert.equal(a.weft.maxFloat, 9);
  assert.equal(a.weft.histogram[9], 1);
  assert.equal(a.heat.weft[0], HEAT.VIOLATION);
  assert.equal(a.heat.weft[9], HEAT.NONE); // background not counted by default
  const withBg = analyze(d, W, H, { lmax: 7, countBackground: true });
  assert.ok(withBg.weft.runs > a.weft.runs);
  // cyclic: row of 1,1,0,..,1,1,1 wraps
  const row = Uint8Array.from([1, 1, 0, 0, 0, 1, 1, 1]);
  assert.equal(analyze(row, 8, 1, { lmax: 7, cyclic: true }).weft.perColour[1].maxFloat, 5);
  assert.equal(analyze(row, 8, 1, { lmax: 7, cyclic: false }).weft.perColour[1].maxFloat, 3);
  assert.ok(a.densityPct > 0);
});

test('binder spacing and stagger', () => {
  assert.deepEqual(binderPlan(7, 7), { n: 0, spacing: 7 });
  assert.deepEqual(binderPlan(8, 7), { n: 1, spacing: 4 });
  assert.equal(binderPlan(15, 7).n, 2);
  assert.equal(binderPlan(15, 7).spacing, 5);
  assert.equal(staggerOffset(3, 2, 5), 1);
  assert.equal(staggerOffset(2, 3, 5), 1);
  // every segment legal for all L, lines and k
  for (const lmax of [3, 7]) for (const k of [2, 3]) for (let L = lmax + 1; L < 80; L++) for (let line = 0; line < 12; line++) {
    const pos = binderPositions(L, lmax, line, k);
    assert.equal(pos.length, binderPlan(L, lmax).n);
    let prev = -1;
    for (const p of pos) { assert.ok(p > prev && p < L); assert.ok(p - prev - 1 <= lmax, `L=${L}`); prev = p; }
    assert.ok(L - prev - 1 <= lmax);
  }
  // stagger moves binder between adjacent lines for slack runs
  const a = binderPositions(8, 7, 0, 2)[0], b = binderPositions(8, 7, 1, 2)[0];
  assert.notEqual(a, b);
});

test('fix: converges on synthetic stripes and keeps colour count', () => {
  const W = 40, H = 30, d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = x < 20 ? 1 : y < 15 ? 2 : 3;
  const before = usedColours(d);
  const r = fix(d, W, H, PAL, { lmax: 7, k: 2 });
  assert.ok(r.before.violations > 0);
  assert.equal(r.after.violations, 0, JSON.stringify(r.passes));
  assert.ok(r.passes.length <= 5);
  assert.equal(usedColours(r.data), before);
  assert.deepEqual([...d.subarray(0, 3)], [1, 1, 1]); // input untouched
});

test('fix: seamless keeps edges equal and cyclic floats fixed', () => {
  const W = 32, H = 32, d = enforceSeam(Uint8Array.from({ length: W * H }, (_, i) => ((i % W) < 16 ? 1 : 2)), W, H);
  const r = fix(d, W, H, PAL, { lmax: 7, cyclic: true, seamless: true });
  for (let y = 0; y < H; y++) assert.equal(r.data[y * W], r.data[y * W + W - 1]);
  for (let x = 0; x < W; x++) assert.equal(r.data[x], r.data[(H - 1) * W + x]);
  assert.equal(r.after.violations, 0, JSON.stringify(r.passes));
});

test('validator gates', () => {
  const params = makeParams({ colours: 2, tileWidth: 120 });
  const W = 120, H = 20, d = new Uint8Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = (((i % W) >> 1) + (((i / W) | 0) >> 1)) % 2; // 2x2 checker: no floats, no specks
  let v = validate({ indices: d, W, H, params });
  assert.ok(v.ok, JSON.stringify(v.checks.filter((c) => !c.pass)));
  assert.ok(canExport(v));
  // colour count over bpp
  const d3 = Uint8Array.from(d); d3[0] = 2;
  v = validate({ indices: d3, W, H, params });
  assert.ok(!v.checks.find((c) => c.id === 'colours').pass);
  assert.ok(!canExport(v)); assert.ok(canExport(v, true));
  // module and hooks
  v = validate({ indices: new Uint8Array(100 * 4), W: 100, H: 4, params });
  assert.ok(!v.checks.find((c) => c.id === 'hookModule').pass);
  assert.ok(!v.checks.find((c) => c.id === 'hooksTile').pass);
  // float gate
  const f = new Uint8Array(W * H).fill(1);
  v = validate({ indices: f, W, H, params: { ...params, countBackground: false } });
  assert.ok(!v.checks.find((c) => c.id === 'weftFloat').pass);
  // seamless gate
  const s = Uint8Array.from(d); s[0] = 1; s[W - 1] = 0;
  v = validate({ indices: s, W, H, params, seamless: true });
  assert.ok(!v.checks.find((c) => c.id === 'seamlessLR').pass);
  v = validate({ indices: s, W, H, params, seamless: false });
  assert.ok(v.checks.find((c) => c.id === 'seamlessLR').skipped);
  // min feature
  const m = new Uint8Array(W * H); m[5 * W + 5] = 1;
  v = validate({ indices: m, W, H, params });
  assert.ok(!v.checks.find((c) => c.id === 'minFeature').pass);
  // same speck, flagged as a fixer binder: excluded but reported
  const bm = new Uint8Array(W * H); bm[5 * W + 5] = 1;
  v = validate({ indices: m, W, H, params, binderMask: bm });
  const mf = v.checks.find((c) => c.id === 'minFeature');
  assert.ok(mf.pass); assert.match(mf.detail, /binder-caused/);
});

const fixtureFiles = readdirSync(new URL('../fixtures/', import.meta.url)).filter((f) => f.endsWith('.png'));
for (const name of fixtureFiles) {
  for (const seamless of [false, true]) {
    test(`fixture ${name} (seamless=${seamless}): fix reaches zero violations, colours unchanged`, () => {
      const params = makeParams({ colours: 6 });
      const { width, height, rgba } = decodePng(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
      const W = params.tileWidth, H = correctedHeight(width, height, W, params);
      const small = resize(flattenAlpha(rgba), width, height, W, H, 'area');
      const q = quantize(small, W, H, params.colours);
      let idx = despeckle(q.indices, W, H, params.minFeature, seamless);
      if (seamless) idx = enforceSeam(idx, W, H);
      const t0 = performance.now();
      const r = fix(idx, W, H, q.palette, { lmax: params.lmax, k: 2, cyclic: seamless, seamless });
      const ms = performance.now() - t0;
      assert.equal(r.after.violations, 0, `passes: ${JSON.stringify(r.passes)}`);
      assert.equal(usedColours(r.data), usedColours(idx));
      assert.ok(ms < 2000);
    });
  }
}

test('performance: analyze + fix 960x2000 under 2s', () => {
  const W = 960, H = 2000, d = new Uint8Array(W * H);
  let seed = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    d[y * W + x] = Math.floor(x / 60 + y / 50) % 4 + (seed % 97 === 0 ? 1 : 0);
  }
  const t0 = performance.now();
  const r = fix(d, W, H, PAL.concat([[9, 9, 9]]), { lmax: 7, k: 2 });
  const ms = performance.now() - t0;
  console.log(`  960x2000 analyze+fix: ${ms.toFixed(0)} ms, violations ${r.before.violations} -> ${r.after.violations}, passes ${r.passes.length}`);
  assert.ok(ms < 2000, `${ms} ms`);
});
