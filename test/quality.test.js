import test from 'node:test';
import assert from 'node:assert/strict';
import { kmeansPalette } from '../src/core/quantize.js';
import { voteDownsample } from '../src/core/resize.js';
import { despeckle, smallBlobStats } from '../src/core/despeckle.js';
import { buildTile } from '../src/core/pipeline.js';
import { makeParams } from '../src/core/params.js';

function solid(w, h, parts) { // parts: [{x0,x1,rgb}] vertical stripes
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = parts.find((p) => x >= p.x0 && x < p.x1).rgb, o = (y * w + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  return px;
}

test('kmeans palette keeps a small distinct accent colour', () => {
  const rgba = solid(100, 10, [{ x0: 0, x1: 96, rgb: [100, 20, 25] }, { x0: 96, x1: 100, rgb: [30, 110, 110] }]);
  const pal = kmeansPalette(rgba, 2);
  assert.equal(pal.length, 2);
  assert.ok(pal.some((c) => c[1] > 90 && c[0] < 60), 'teal accent survives');
});

test('voteDownsample keeps a thin line that area-averaging would blur', () => {
  const sw = 8, idx = new Uint8Array(sw * sw);
  for (let y = 0; y < sw; y++) idx[y * sw + 3] = 1; // 1px line in 8px field, 2x downsample
  const out = voteDownsample(idx, sw, sw, 4, 4, 2, 0, 1.6);
  assert.deepEqual([...out.slice(0, 4)], [0, 1, 0, 0]);
});

test('despeckle resolves a 1px blob whose diagonal neighbours share its colour', () => {
  const d = Uint8Array.from([1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0].slice(0, 0).concat([
    1, 1, 1, 1, 1,
    1, 0, 1, 0, 1,
    1, 1, 0, 1, 1,
    1, 0, 1, 0, 1,
    1, 1, 1, 1, 1]));
  assert.equal(smallBlobStats(despeckle(d, 5, 5, 2), 5, 5, 2).total, 0);
});

test('vote pipeline yields palette-pure tile with background = most common colour', () => {
  const rgba = solid(240, 240, [{ x0: 0, x1: 200, rgb: [100, 20, 25] }, { x0: 200, x1: 240, rgb: [230, 220, 190] }]);
  const t = buildTile({ width: 240, height: 240, rgba }, makeParams({ colours: 2, tileWidth: 120 }), {});
  assert.equal(t.palette.length, 2);
  assert.deepEqual(t.palette[0], [100, 20, 25]);
});

test('validTileWidths lists divisors of hooks that are multiples of the hook module', async () => {
  const { validTileWidths } = await import('../src/core/params.js');
  assert.deepEqual(validTileWidths({ hooks: 960, hookModule: 8 }).slice(0, 6), [8, 16, 24, 32, 40, 48]);
  assert.ok(validTileWidths({ hooks: 960, hookModule: 8 }).includes(240));
  assert.ok(!validTileWidths({ hooks: 960, hookModule: 8 }).includes(100));
});
