import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { decodePng } from './helpers/png.js';
import { encodeBmp, decodeBmp, exportBmp, exportFilename } from '../src/core/bmp.js';
import { bmpRowSize, bmpFileSize, makeParams, correctedHeight } from '../src/core/params.js';
import { buildReport, reportToJSON, reportToCSV } from '../src/core/report.js';
import { createHistory } from '../src/core/history.js';
import { analyze, summarize } from '../src/core/analyze.js';
import { validate, canExport } from '../src/core/validator.js';
import { fix } from '../src/core/fixer.js';
import { quantize, usedColours } from '../src/core/quantize.js';
import { resize, flattenAlpha } from '../src/core/resize.js';
import { despeckle } from '../src/core/despeckle.js';

const pal = (n) => Array.from({ length: n }, (_, i) => [i * 13 % 256, i * 29 % 256, i * 53 % 256]);
const rnd = (n, mod, seed = 7) => Uint8Array.from({ length: n }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) % mod);

test('BMP header bytes', () => {
  const W = 120, H = 10, bpp = 4;
  const b = encodeBmp({ indices: rnd(W * H, 6), width: W, height: H, palette: pal(6), bpp, epi: 80, ppi: 80 });
  const dv = new DataView(b.buffer);
  assert.equal(String.fromCharCode(b[0], b[1]), 'BM');
  assert.equal(dv.getUint32(2, true), b.length);
  assert.equal(b.length, bmpFileSize(bpp, W, H));
  assert.equal(dv.getUint32(10, true), 14 + 40 + 16 * 4);
  assert.equal(dv.getUint32(14, true), 40);
  assert.equal(dv.getInt32(18, true), W);
  assert.equal(dv.getInt32(22, true), H); // positive: bottom-up
  assert.equal(dv.getUint16(26, true), 1);
  assert.equal(dv.getUint16(28, true), 4);
  assert.equal(dv.getUint32(30, true), 0);
  assert.equal(dv.getUint32(34, true), bmpRowSize(4, W) * H);
  assert.equal(dv.getInt32(38, true), 3150); // 80 * 39.37
  assert.equal(dv.getInt32(42, true), 3150);
  // BGRA palette order
  const p = pal(6);
  assert.deepEqual([b[54], b[55], b[56], b[57]], [p[0][2], p[0][1], p[0][0], 0]);
  assert.deepEqual([b[58], b[59], b[60]], [p[1][2], p[1][1], p[1][0]]);
});

test('EPI/PPI map to X/Y pels per metre separately', () => {
  const b = encodeBmp({ indices: new Uint8Array(4), width: 2, height: 2, palette: pal(2), bpp: 1, epi: 80, ppi: 60 });
  const dv = new DataView(b.buffer);
  assert.equal(dv.getInt32(38, true), Math.round(80 * 39.37));
  assert.equal(dv.getInt32(42, true), Math.round(60 * 39.37));
});

test('row padding 1/4/8 bpp', () => {
  const cases = { 1: [[1, 4], [32, 4], [33, 8], [120, 16], [960, 120]], 4: [[1, 4], [8, 4], [9, 8], [120, 60], [960, 480]], 8: [[1, 4], [4, 4], [5, 8], [120, 120], [961, 964]] };
  for (const bpp of [1, 4, 8]) for (const [W, expect] of cases[bpp]) {
    assert.equal(bmpRowSize(bpp, W), expect, `${bpp}bpp W=${W}`);
    const H = 3;
    const b = encodeBmp({ indices: new Uint8Array(W * H), width: W, height: H, palette: pal(2), bpp });
    assert.equal(b.length, 54 + (1 << bpp) * 4 + expect * H);
  }
});

test('round trip decode, all bpp, odd widths, orientation', () => {
  for (const [bpp, n] of [[1, 2], [4, 16], [8, 256]]) for (const W of [1, 7, 8, 9, 33, 120]) {
    const H = 5, idx = rnd(W * H, n, W + bpp);
    const b = encodeBmp({ indices: idx, width: W, height: H, palette: pal(n), bpp });
    const d = decodeBmp(b);
    assert.equal(d.width, W); assert.equal(d.height, H); assert.equal(d.bpp, bpp);
    assert.deepEqual([...d.indices], [...idx], `bpp ${bpp} W ${W}`);
    assert.deepEqual(d.palette[1], pal(n)[1]);
  }
  // bottom-up: first stored row is the last image row
  const idx = Uint8Array.from([0, 0, 1, 1]); // top row 0,0 ; bottom row 1,1
  const b = encodeBmp({ indices: idx, width: 2, height: 2, palette: pal(2), bpp: 8 });
  const off = 14 + 40 + 256 * 4;
  assert.equal(b[off], 1); // first stored row = bottom row
  assert.equal(b[off + 4], 0);
});

test('decode 24-bit fixture BMP', () => {
  const d = decodeBmp(new Uint8Array(readFileSync(new URL('../fixtures/F_Image_o1fl55o1fl55o1fl-2.bmp', import.meta.url))));
  assert.equal(d.width, 512); assert.equal(d.height, 512); assert.equal(d.bpp, 24);
  assert.equal(d.rgba.length, 512 * 512 * 4);
  assert.throws(() => decodeBmp(new Uint8Array(100)), /Not a BMP/);
});

test('export: filename, tile vs body', () => {
  const params = makeParams({ colours: 2 });
  const W = 120, H = 6, idx = rnd(W * H, 2);
  assert.equal(exportFilename(120, 6, 1), 'design_120x6_1bpp.bmp');
  const t = exportBmp({ indices: idx, W, H, palette: pal(2), bpp: 1, params, scope: 'tile' });
  assert.equal(t.filename, 'design_120x6_1bpp.bmp');
  const body = exportBmp({ indices: idx, W, H, palette: pal(2), bpp: 1, params, scope: 'body' });
  assert.equal(body.filename, 'design_960x6_1bpp.bmp');
  const d = decodeBmp(body.bytes);
  assert.equal(d.width, 960);
  for (let r = 0; r < 8; r++) assert.deepEqual([...d.indices.subarray(r * W, (r + 1) * W)], [...idx.subarray(0, W)]);
  assert.throws(() => exportBmp({ indices: new Uint8Array(110 * 2), W: 110, H: 2, palette: pal(2), bpp: 1, params, scope: 'body' }), /multiple/);
  assert.throws(() => encodeBmp({ indices: new Uint8Array(4), width: 2, height: 2, palette: pal(3), bpp: 1 }), /allows 2/);
  assert.throws(() => encodeBmp({ indices: new Uint8Array(4), width: 2, height: 2, palette: pal(2), bpp: 2 }), /Unsupported/);
});

test('history: undo, redo, revert', () => {
  const h = createHistory('a');
  h.push('b'); h.push('c');
  assert.equal(h.undo(), 'b'); assert.ok(h.canRedo);
  assert.equal(h.redo(), 'c');
  assert.equal(h.revert(), 'a');
  assert.equal(h.undo(), 'c');
  h.undo(); h.push('d');
  assert.ok(!h.canRedo);
  assert.equal(h.original, 'a');
});

test('report JSON and CSV', () => {
  const params = makeParams();
  const W = 120, H = 4, d = new Uint8Array(W * H).fill(1);
  const mk = (idx) => ({ summary: summarize(analyze(idx, W, H, { lmax: 7 })), validation: validate({ indices: idx, W, H, params }) });
  const r = buildReport({ params, before: mk(d), after: mk(new Uint8Array(W * H)) });
  const j = JSON.parse(reportToJSON(r));
  assert.equal(j.before.validation.ok, false);
  const csv = reportToCSV(r);
  assert.match(csv, /^"section","name","before","after"/);
  assert.match(csv, /"check","weftFloat","FAIL"/);
  assert.match(csv, /"check","overall"/);
});

const names = readdirSync(new URL('../fixtures/', import.meta.url)).filter((f) => f.endsWith('.png'));
for (const name of names) {
  test(`end-to-end ${name}: fix → validate → export → decode`, () => {
    const params = makeParams({ colours: 6 });
    const { width, height, rgba } = decodePng(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
    const W = params.tileWidth, H = correctedHeight(width, height, W, params);
    const q = quantize(resize(flattenAlpha(rgba), width, height, W, H), W, H, params.colours);
    const idx = despeckle(q.indices, W, H, params.minFeature);
    const r = fix(idx, W, H, q.palette, { lmax: params.lmax, k: 2 });
    const v = validate({ indices: r.data, W, H, params, binderMask: r.binderMask });
    assert.ok(v.ok, JSON.stringify(v.checks.filter((c) => !c.pass)));
    assert.ok(canExport(v));
    const out = exportBmp({ indices: r.data, W, H, palette: q.palette, bpp: 4, params, scope: 'tile' });
    assert.equal(out.bytes.length, v.fileSize);
    const back = decodeBmp(out.bytes);
    assert.deepEqual([...back.indices], [...r.data]);
    assert.equal(usedColours(back.indices), usedColours(idx));
    assert.deepEqual(back.palette.slice(0, q.palette.length), q.palette);
  });
}
