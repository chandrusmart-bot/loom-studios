import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from './helpers/png.js';
import * as P from '../src/core/params.js';
import { findRuns } from '../src/core/runs.js';
import { resize, flattenAlpha } from '../src/core/resize.js';
import { quantize, usedColours, mergeColours } from '../src/core/quantize.js';
import { despeckle, countSmallBlobs } from '../src/core/despeckle.js';
import { edgeBlend, mirror, checkSeamless, enforceSeam, tileIndexed } from '../src/core/seamless.js';

test('params: defaults, bpp, repeats, mm, height', () => {
  const p = P.makeParams();
  assert.equal(P.repeats(p), 8);
  assert.ok(P.repeatsIsInteger(p));
  assert.ok(!P.repeatsIsInteger({ ...p, tileWidth: 110 }));
  assert.deepEqual([2, 3, 16, 17, 256, 257].map(P.bppForColours), [1, 4, 4, 8, 8, null]);
  assert.equal(P.bppForColours(0), null);
  assert.ok(Math.abs(P.floatMm(7, 80) - 2.2225) < 1e-9);
  assert.equal(P.correctedHeight(100, 100, 120, { epi: 80, ppi: 80 }), 120);
  assert.equal(P.correctedHeight(100, 100, 120, { epi: 80, ppi: 40 }), 60);
  assert.equal(P.applyPreset(p, 'meena').colours, 6);
  assert.equal(P.applyPreset(p, 'single').colours, 2);
  assert.deepEqual([1, 4, 8].map((b) => P.bmpRowSize(b, 120)), [16, 60, 120]);
  assert.equal(P.bmpRowSize(1, 33), 8);
});

test('runs: non-cyclic and cyclic wrap', () => {
  // row: 1 1 0 1 1 1  (W=6,H=1)
  const m = Uint8Array.from([1, 1, 0, 1, 1, 1]);
  const lin = findRuns(m, 6, 1, 'weft', false);
  assert.deepEqual(lin.lens, [2, 3]);
  const cyc = findRuns(m, 6, 1, 'weft', true);
  assert.deepEqual(cyc.lens, [5]); // 3 trailing + 2 leading wrap
  assert.equal(cyc.starts[0], 3);
  // full ring
  assert.deepEqual(findRuns(Uint8Array.from([1, 1, 1]), 3, 1, 'weft', true).lens, [3]);
  // warp: column 0 = 1,0,1,1 (H=4) -> cyclic run of 3 starting at row 2
  const col = Uint8Array.from([1, 0, 1, 0, 1, 1, 0, 0].filter((_, i) => i % 2 === 0)); // W=1 column: 1,1,1,0? keep simple below
  const wm = Uint8Array.from([1, 0, 1, 1]);
  const w = findRuns(wm, 1, 4, 'warp', true);
  assert.deepEqual(w.lens, [3]);
  assert.equal(w.starts[0], 2);
  assert.deepEqual(findRuns(wm, 1, 4, 'warp', false).lens, [1, 2]);
  void col;
});

test('resize: area average and nearest', () => {
  const src = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const a = resize(src, 4, 1, 2, 1, 'area');
  assert.equal(a[0], 128); assert.equal(a[4], 128);
  const n = resize(src, 4, 1, 2, 1, 'nearest');
  assert.equal(n[0], 255); assert.equal(n[4], 255); // centres sample src px 1 and 3
  const f = flattenAlpha(new Uint8Array([0, 0, 0, 0]));
  assert.deepEqual([...f], [255, 255, 255, 255]);
});

function rgbaFrom(colours, W, H, fn) {
  const o = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const c = colours[fn(i % W, (i / W) | 0)]; o.set([...c, 255], i * 4); }
  return o;
}

test('quantize: colour limit, background index 0, merge', () => {
  const cols = [[250, 250, 250], [200, 0, 0], [0, 150, 0], [0, 0, 200]];
  const W = 40, H = 40;
  const img = rgbaFrom(cols, W, H, (x, y) => (x < 4 || y < 4 ? 0 : x < 20 ? 1 : y < 20 ? 2 : 3));
  const q = quantize(img, W, H, 4);
  assert.equal(q.palette.length, 4);
  assert.equal(usedColours(q.indices), 4);
  assert.deepEqual(q.palette[0], [250, 250, 250]); // border colour is index 0
  const q2 = quantize(img, W, H, 2);
  assert.ok(usedColours(q2.indices) <= 2);
  const d = quantize(img, W, H, 3, { dither: 'ordered' });
  assert.ok(usedColours(d.indices) <= 3);
  const m = mergeColours(q.indices, q.palette, 1, 2);
  assert.equal(m.palette.length, 3);
  assert.throws(() => quantize(img, W, H, 0));
  const forced = quantize(img, W, H, 4, { background: [0, 0, 200] });
  assert.deepEqual(forced.palette[0], [0, 0, 200]);
});

test('despeckle removes single pixels, keeps larger blobs and colour set', () => {
  const W = 8, H = 8, d = new Uint8Array(W * H).fill(0);
  d[3 * W + 3] = 1; // speck
  for (let y = 5; y < 7; y++) for (let x = 5; x < 7; x++) d[y * W + x] = 2;
  assert.equal(countSmallBlobs(d, W, H, 2), 1);
  const o = despeckle(d, W, H, 2);
  assert.equal(o[3 * W + 3], 0);
  assert.equal(o[5 * W + 5], 2);
  assert.equal(countSmallBlobs(o, W, H, 2), 0);
  assert.equal(d[3 * W + 3], 1); // input untouched
});

test('seamless: mirror, blend, enforce, tile', () => {
  const W = 6, H = 4;
  const idx = Uint8Array.from({ length: W * H }, (_, i) => i % 7);
  const e = enforceSeam(idx, W, H);
  assert.ok(checkSeamless(e, W, H).lr && checkSeamless(e, W, H).tb);
  assert.ok(!checkSeamless(idx, W, H).lr);
  const rgba = new Uint8Array(W * H * 4).map((_, i) => (i * 37) % 256);
  const mi = mirror(rgba, W, H, 4);
  assert.equal(mi[0], mi[(W - 1) * 4]);
  const bl = edgeBlend(rgba, W, H, 2, 4);
  assert.equal(bl[0], bl[(W - 1) * 4]); // edge pixels become equal across the seam
  const t = tileIndexed(Uint8Array.from([1, 2, 3, 4]), 2, 2, 3, 3);
  assert.equal(t.length, 36);
  assert.deepEqual([...t.subarray(0, 6)], [1, 2, 1, 2, 1, 2]);
});

test('fixtures decode and quantize to tile width', () => {
  const buf = readFileSync(new URL('../fixtures/Image_gejqingejqingejq.png', import.meta.url));
  const { width, height, rgba } = decodePng(buf);
  assert.equal(width, 1024);
  const flat = flattenAlpha(rgba);
  const W = 120, H = P.correctedHeight(width, height, W, P.makeParams());
  const small = resize(flat, width, height, W, H, 'area');
  const q = quantize(small, W, H, 6);
  assert.ok(usedColours(q.indices) <= 6);
});

import { swapColours } from '../src/core/quantize.js';
test('swapColours moves a colour to index 0', () => {
  const r = swapColours(Uint8Array.from([0, 1, 2, 1]), [[1, 1, 1], [2, 2, 2], [3, 3, 3]], 0, 1);
  assert.deepEqual([...r.indices], [1, 0, 2, 0]);
  assert.deepEqual(r.palette[0], [2, 2, 2]);
  assert.deepEqual(r.palette[1], [1, 1, 1]);
});
