// Loom Float Fixer UI. DOM only: all processing lives in /src/core.
import { makeParams, applyPreset, PRESETS, repeats, repeatsIsInteger, floatMm, bppForColours, correctedHeight } from '../core/params.js';
import { DEFAULT_SETTINGS, buildTile } from '../core/pipeline.js';
import { analyze, summarize, HEAT } from '../core/analyze.js';
import { fix } from '../core/fixer.js';
import { validate, canExport } from '../core/validator.js';
import { mergeColours, setPaletteColour, swapColours, usedColours } from '../core/quantize.js';
import { createHistory } from '../core/history.js';
import { indexedToRgba, applyHeat, tileRgba } from '../core/preview.js';
import { exportBmp } from '../core/bmp.js';
import { buildReport, reportToJSON, reportToCSV } from '../core/report.js';
import { runSelfTests } from '../core/selftest.js';
import { CanvasView } from './canvas-view.js';

const $ = (id) => document.getElementById(id);
const STEPS = [['upload', 'Upload'], ['settings', 'Settings'], ['quantize', 'Quantize'], ['analyze', 'Analyze'], ['fix', 'Fix'], ['export', 'Export']];
// Changing these invalidates the quantized tile (and any fix applied to it).
const REBUILD_PARAMS = new Set(['tileWidth', 'epi', 'ppi', 'colours', 'minFeature']);
const REBUILD_SETTINGS = new Set(['resizeMode', 'lockAspect', 'height', 'dither', 'seamless', 'blendBand', 'despeckle']);

const state = {
  src: null,
  params: makeParams(),
  settings: { ...DEFAULT_SETTINGS },
  hist: null,
  seamless: false,
  fixInfo: null,
  step: 'upload',
  view: { mode: 'original', heat: 'both', compare: 'after' },
  override: false,
  scope: 'tile',
  k: 2,
  cache: new WeakMap(),
};

const cur = () => state.hist && state.hist.current;
const orig = () => state.hist && state.hist.original;

// ---------- errors ----------
function showError(msg) { const b = $('banner'); b.textContent = msg; b.classList.add('show'); }
function clearError() { $('banner').classList.remove('show'); }
function guard(fn) { return (...a) => { try { clearError(); return fn(...a); } catch (e) { console.error(e); showError(e.message || String(e)); } }; }

// ---------- derived data (cached per snapshot) ----------
function analysisFor(snap) {
  const key = `${state.params.lmax}|${state.seamless}|${!!state.params.countBackground}`;
  let c = state.cache.get(snap);
  if (!c || c.key !== key) {
    c = { key, a: analyze(snap.indices, state.tile.W, state.tile.H, { lmax: state.params.lmax, cyclic: state.seamless, countBackground: !!state.params.countBackground }) };
    state.cache.set(snap, c);
  }
  return c.a;
}
function validationFor(snap) {
  const c = state.cache.get(snap);
  if (c && c.vkey === c.key + JSON.stringify(state.params)) return c.v;
  const v = validate({ indices: snap.indices, W: state.tile.W, H: state.tile.H, params: state.params, seamless: state.seamless, analysis: analysisFor(snap), binderMask: snap.binderMask });
  const cc = state.cache.get(snap); cc.v = v; cc.vkey = cc.key + JSON.stringify(state.params);
  return v;
}

// ---------- loading ----------
async function loadFile(file) {
  if (!file) return;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('That file could not be read as an image. Use PNG, JPG or BMP.'); }
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  if (bmp.width * bmp.height > 50e6) throw new Error(`Image is too large (${(bmp.width * bmp.height / 1e6).toFixed(0)} MP; limit 50 MP). Downscale it first.`);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  state.src = { name: file.name, width: bmp.width, height: bmp.height, rgba: g.getImageData(0, 0, bmp.width, bmp.height).data };
  state.hist = null; state.tile = null; state.fixInfo = null;
  state.view.mode = 'original';
  go('settings');
  rebuild();
}

function rebuild() {
  if (!state.src) return;
  state.fixInfo = null;
  state.focus = null;
  try {
    const t = buildTile(state.src, state.params, state.settings);
    state.tile = t; state.seamless = t.seamless;
    const snap = { indices: t.indices, palette: t.palette, binderMask: null };
    if (state.hist) state.hist.reset(snap); else state.hist = createHistory(snap);
    if (state.view.mode === 'original') state.view.mode = 'tile';
  } catch (e) {
    state.hist = null; state.tile = null;
    showError(e.message);
  }
  refresh(true);
}

function pushSnap(s) { state.hist.push(s); refresh(); }

// ---------- wizard ----------
function reachable(id) {
  if (id === 'upload') return true;
  if (id === 'settings' || id === 'quantize') return !!state.src;
  return !!state.hist;
}
function go(id) { if (!reachable(id)) return; state.step = id; renderSteps(); renderLeft(); }
function renderSteps() {
  const nav = $('steps'); nav.textContent = '';
  STEPS.forEach(([id, label], i) => {
    const b = document.createElement('button');
    b.textContent = `${i + 1}. ${label}`;
    b.disabled = !reachable(id);
    b.className = id === state.step ? 'active' : '';
    b.onclick = () => go(id);
    nav.append(b);
  });
}

// ---------- left panel ----------
const num = (key, label, tip, extra = '') => `<div><label title="${tip}">${label}</label><input type="number" data-p="${key}" value="${state.params[key]}" ${extra}></div>`;
const chk = (key, label, on, scope = 's') => `<label class="inline"><input type="checkbox" data-${scope}="${key}" ${on ? 'checked' : ''}> ${label}</label>`;

function nav(prev, next) {
  return `<div class="btns">${prev ? `<button data-go="${prev}">Back</button>` : ''}${next ? `<button class="primary" data-go="${next}" ${reachable(next) ? '' : 'disabled'}>Next</button>` : ''}</div>`;
}

function renderLeft() {
  const p = state.params, s = state.settings, el = $('left');
  const html = {
    upload: () => `<h2>1. Upload</h2>
      <div class="dropzone" id="drop">Drop a PNG / JPG / BMP here<br>or click to choose<input id="file" type="file" accept="image/*,.bmp" hidden></div>
      <p class="hint">Everything runs locally in this page. Nothing is uploaded.</p>
      ${state.src ? `<p class="hint">${state.src.width}×${state.src.height}px loaded.</p>` : ''}
      ${nav(null, 'settings')}`,
    settings: () => `<h2>2. Loom settings</h2>
      <div class="row">${num('hooks', 'Hooks', 'Total hooks on the loom')}${num('tileWidth', 'Tile width (px)', 'Design width in hooks; the tile repeats across the loom')}</div>
      <div class="row">${num('hookModule', 'Hook module', 'Width must be a multiple of this')}${num('lmax', 'Lmax (ends/picks)', 'Longest allowed float')}</div>
      <div class="row">${num('epi', 'EPI', 'Ends per inch (horizontal density)')}${num('ppi', 'PPI', 'Picks per inch (vertical density)')}</div>
      <div class="row">${num('colours', 'Colours (incl. bg)', 'Total colours including background. 2 = 1-bpp, up to 16 = 4-bpp, up to 256 = 8-bpp', 'min="1" max="256"')}${num('minFeature', 'Min feature (px)', 'Blobs with fewer pixels than this are removed')}</div>
      <div class="btns">${Object.entries(PRESETS).map(([k, v]) => `<button data-preset="${k}" title="${v.note}">${v.label}</button>`).join('')}</div>
      <p class="hint" id="derived"></p>
      <h3>Resize</h3>
      <div class="row"><div><label>Method</label><select data-s="resizeMode"><option value="area" ${s.resizeMode === 'area' ? 'selected' : ''}>Area average</option><option value="nearest" ${s.resizeMode === 'nearest' ? 'selected' : ''}>Nearest</option></select></div>
      <div><label title="Height in picks when aspect lock is off">Height (picks)</label><input type="number" data-s="height" min="1" value="${s.height || (state.tile ? state.tile.H : '')}" ${s.lockAspect ? 'disabled' : ''}></div></div>
      ${chk('lockAspect', 'Lock aspect (corrected for EPI/PPI)', s.lockAspect)}
      ${chk('countBackground', 'Count background floats as violations', p.countBackground, 'p')}
      ${nav('upload', 'quantize')}`,
    quantize: () => `<h2>3. Quantize</h2>
      <div class="row">${num('colours', 'Colours (incl. bg)', 'Total colours including background', 'min="1" max="256"')}<div><label>Dither</label><select data-s="dither"><option value="none" ${s.dither === 'none' ? 'selected' : ''}>Off</option><option value="ordered" ${s.dither === 'ordered' ? 'selected' : ''}>Ordered</option></select></div></div>
      <div class="row"><div><label title="Make opposite tile edges meet">Seamless</label><select data-s="seamless"><option value="off" ${s.seamless === 'off' ? 'selected' : ''}>Off</option><option value="blend" ${s.seamless === 'blend' ? 'selected' : ''}>Edge blend</option><option value="mirror" ${s.seamless === 'mirror' ? 'selected' : ''}>Mirror</option></select></div>
      <div><label>Blend band (px)</label><input type="number" data-s="blendBand" min="1" value="${s.blendBand}"></div></div>
      ${chk('despeckle', 'Despeckle (min feature)', s.despeckle)}
      <h3>Palette <span class="hint">(index 0 = background)</span></h3>
      <div class="palette" id="palette"></div>
      <div class="row" style="margin-top:8px"><div><label>Merge</label><select id="mergeFrom"></select></div><div><label>into</label><select id="mergeInto"></select></div></div>
      <div class="btns"><button id="doMerge">Merge colours</button></div>
      ${nav('settings', 'analyze')}`,
    analyze: () => `<h2>4. Analyze</h2>
      <p class="hint">Weft float = same colour across consecutive ends in a pick. Warp float = same colour down consecutive picks.${state.seamless ? ' Runs wrap across tile edges (seamless).' : ''}</p>
      <div class="row"><div><label>Lmax</label><input type="number" data-p="lmax" min="1" value="${p.lmax}"></div><div class="hint" id="mm"></div></div>
      <h3>Violations <span class="hint">(longest first; click to zoom)</span></h3>
      <div class="vlist" id="vlist"></div>
      ${nav('quantize', 'fix')}`,
    fix: () => `<h2>5. Fix</h2>
      <p class="hint">Breaks each over-long float with single-pixel binders, staggered across adjacent lines. Up to 5 passes, re-validated each pass. Only existing colours are used.</p>
      <div class="row"><div><label title="Stagger multiplier: offset = (line × k) mod spacing">Stagger k</label><select id="k"><option value="2" ${state.k === 2 ? 'selected' : ''}>2</option><option value="3" ${state.k === 3 ? 'selected' : ''}>3</option></select></div></div>
      <div class="btns"><button class="primary" id="runFix">Run auto-fix</button><button id="revert2">Revert to original</button></div>
      <p class="hint" id="fixInfo"></p>
      ${nav('analyze', 'export')}`,
    export: () => `<h2>6. Export</h2>
      <div class="row"><div><label>Scope</label><select id="scope"><option value="tile" ${state.scope === 'tile' ? 'selected' : ''}>Single tile</option><option value="body" ${state.scope === 'body' ? 'selected' : ''}>Full body (tile × repeats)</option></select></div></div>
      <p class="hint" id="exportName"></p>
      <label class="inline" title="Allow export even though a check fails"><input type="checkbox" id="override" ${state.override ? 'checked' : ''}> Export anyway (override failed checks)</label>
      <div class="btns"><button class="primary" id="dlBmp">Download BMP</button><button id="dlJson">Report JSON</button><button id="dlCsv">Report CSV</button><button id="dlPng">Preview PNG</button></div>
      <p class="hint" id="exportMsg"></p>
      ${nav('fix', null)}`,
  }[state.step]();
  el.innerHTML = html;
  bindLeft();
  fillLeft();
}

function bindLeft() {
  const el = $('left');
  el.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  el.querySelectorAll('[data-p]').forEach((i) => {
    i.onchange = guard(() => {
      const k = i.dataset.p;
      state.params[k] = i.type === 'checkbox' ? i.checked : Number(i.value);
      if (REBUILD_PARAMS.has(k)) rebuild(); else refresh(); // analysis-only params keep the fix
      renderLeft();
    });
  });
  el.querySelectorAll('[data-s]').forEach((i) => {
    i.onchange = guard(() => {
      const k = i.dataset.s;
      state.settings[k] = i.type === 'checkbox' ? i.checked : i.tagName === 'SELECT' ? i.value : (i.value === '' ? null : Number(i.value));
      if (REBUILD_SETTINGS.has(k)) rebuild();
      renderLeft();
    });
  });
  el.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = guard(() => { state.params = applyPreset(state.params, b.dataset.preset); rebuild(); renderLeft(); });
  });
  const drop = $('drop');
  if (drop) {
    const file = $('file');
    drop.onclick = () => file.click();
    file.onchange = () => loadFile(file.files[0]).catch((e) => showError(e.message));
  }
  const on = (id, fn) => { const n = $(id); if (n) n.onclick = guard(fn); };
  on('doMerge', () => {
    const from = Number($('mergeFrom').value), into = Number($('mergeInto').value);
    if (from === into) throw new Error('Pick two different colours to merge.');
    const c = cur(); const m = mergeColours(c.indices, c.palette, from, into);
    pushSnap({ ...c, indices: m.indices, palette: m.palette });
    renderLeft();
  });
  on('runFix', runFix);
  on('revert2', () => { state.hist.revert(); state.fixInfo = null; refresh(); });
  on('dlBmp', () => doExport('bmp'));
  on('dlJson', () => doExport('json'));
  on('dlCsv', () => doExport('csv'));
  on('dlPng', () => doExport('png'));
  if ($('k')) $('k').onchange = () => { state.k = Number($('k').value); };
  if ($('scope')) $('scope').onchange = () => { state.scope = $('scope').value; fillLeft(); };
  if ($('override')) $('override').onchange = () => { state.override = $('override').checked; fillLeft(); };
}

// Fills the parts of the left panel that depend on current state.
function fillLeft() {
  const p = state.params;
  if ($('derived')) {
    const ok = repeatsIsInteger(p);
    const h = state.tile ? state.tile.H : p.tileWidth && state.src ? correctedHeight(state.src.width, state.src.height, p.tileWidth, p) : '?';
    $('derived').className = 'hint' + (ok ? '' : ' warn');
    $('derived').textContent = `Repeats = ${repeats(p)}${ok ? '' : ' (warning: hooks is not a multiple of tile width)'} · ${bppForColours(p.colours) ? bppForColours(p.colours) + '-bpp' : 'too many colours'} · Lmax ${p.lmax} = ${floatMm(p.lmax, p.epi).toFixed(2)} mm · tile ${p.tileWidth}×${h}`;
  }
  if ($('mm')) $('mm').textContent = `Lmax ${p.lmax} = ${floatMm(p.lmax, p.epi).toFixed(2)} mm`;
  if ($('palette') && cur()) {
    const pal = $('palette'); pal.textContent = '';
    const c = cur(), counts = new Uint32Array(c.palette.length);
    for (const v of c.indices) counts[v]++;
    c.palette.forEach((rgb, i) => {
      const row = document.createElement('div'); row.className = 'p';
      const inp = document.createElement('input'); inp.type = 'color';
      inp.value = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
      inp.onchange = () => pushSnap({ ...cur(), palette: setPaletteColour(cur().palette, i, [1, 3, 5].map((o) => parseInt(inp.value.slice(o, o + 2), 16))) });
      const lab = document.createElement('span'); lab.textContent = `#${i}${i === 0 ? ' bg' : ''} · ${counts[i]} px`;
      row.append(inp, lab);
      if (i > 0) { const b = document.createElement('button'); b.textContent = 'Make bg'; b.onclick = guard(() => { const sw = swapColours(cur().indices, cur().palette, 0, i); pushSnap({ ...cur(), indices: sw.indices, palette: sw.palette }); renderLeft(); }); row.append(b); }
      pal.append(row);
    });
    for (const id of ['mergeFrom', 'mergeInto']) {
      const sel = $(id); sel.textContent = '';
      c.palette.forEach((_, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `#${i}`; sel.append(o); });
    }
    $('mergeInto').value = '0';
    $('mergeFrom').value = c.palette.length > 1 ? '1' : '0';
  }
  if ($('vlist') && cur()) {
    const list = $('vlist'); list.textContent = '';
    const a = analysisFor(cur());
    const runs = a.violatingRuns.slice().sort((x, y) => y.len - x.len).slice(0, 150);
    if (!runs.length) list.textContent = 'No violations.';
    for (const r of runs) {
      const b = document.createElement('button');
      const where = r.axis === 'weft' ? `pick ${r.line}, ends ${r.start}…` : `end ${r.line}, picks ${r.start}…`;
      b.textContent = `${r.axis} · ${where} · L=${r.len} (${floatMm(r.len, p.epi).toFixed(1)} mm) · colour #${r.colour}`;
      b.onclick = () => focusRun(r);
      list.append(b);
    }
  }
  if ($('fixInfo')) {
    const f = state.fixInfo;
    $('fixInfo').className = 'hint' + (f && !f.converged ? ' warn' : '');
    $('fixInfo').textContent = f ? `${f.converged ? 'Converged' : 'Did NOT fully converge'} after ${f.passes.length} pass(es), ${f.binders} binders. Violations ${f.before.violations} → ${f.after.violations}.` : 'Not run yet.';
  }
  if ($('exportName') && cur()) {
    const e = exportInfo();
    $('exportName').textContent = e.error || `${e.filename} · ~${e.size.toLocaleString()} bytes`;
    const blocked = !canExport(validationFor(cur()), state.override);
    $('dlBmp').disabled = blocked || !!e.error;
    $('exportMsg').className = 'hint' + (blocked ? ' warn' : '');
    $('exportMsg').textContent = blocked ? 'BMP export is blocked: a validator check is failing (see checklist). Tick "Export anyway" to override.' : '';
  }
}

// ---------- actions ----------
function runFix() {
  const c = cur(), { W, H } = state.tile, p = state.params;
  const r = fix(c.indices, W, H, c.palette, { lmax: p.lmax, k: state.k, cyclic: state.seamless, seamless: state.seamless, countBackground: !!p.countBackground });
  const mask = new Uint8Array(c.indices.length);
  for (let i = 0; i < mask.length; i++) mask[i] = (c.binderMask && c.binderMask[i]) || r.binderMask[i];
  state.fixInfo = r;
  state.view.compare = 'after';
  pushSnap({ indices: r.data, palette: c.palette, binderMask: mask });
  fillLeft();
}

function exportInfo() {
  const c = cur(), { W, H } = state.tile, p = state.params;
  const need = bppForColours(c.palette.length), target = bppForColours(p.colours);
  if (!need) return { error: 'More than 256 colours: cannot be written as an indexed BMP.' };
  const bpp = Math.max(target || 8, need);
  try {
    const e = exportBmp({ indices: c.indices, W, H, palette: c.palette, bpp, params: p, scope: state.scope });
    return { ...e, size: e.bytes.length };
  } catch (err) { return { error: err.message }; }
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeReport() {
  const snapSummary = (s) => ({ summary: summarize(analysisFor(s)), validation: validationFor(s) });
  return buildReport({ params: { ...state.params, seamless: state.seamless }, before: snapSummary(orig()), after: snapSummary(cur()), fix: state.fixInfo, generatedAt: new Date().toISOString() });
}

function doExport(kind) {
  if (kind === 'bmp') {
    if (!canExport(validationFor(cur()), state.override)) throw new Error('Export blocked: a validator check is failing.');
    const e = exportInfo(); if (e.error) throw new Error(e.error);
    download(e.filename, e.bytes, 'image/bmp');
  } else if (kind === 'json') download('float-report.json', reportToJSON(makeReport()), 'application/json');
  else if (kind === 'csv') download('float-report.csv', reportToCSV(makeReport()), 'text/csv');
  else {
    const { W, H } = state.tile, S = 4;
    const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    t.getContext('2d').putImageData(new ImageData(indexedToRgba(cur().indices, cur().palette), W, H), 0, 0);
    g.drawImage(t, 0, 0, W * S, H * S);
    c.toBlob((b) => download(`design_${W}x${H}_preview.png`, b, 'image/png'));
  }
}

// ---------- run focus / picking ----------
function runRects(run, ox = 0, oy = 0) {
  const { W, H } = state.tile, weft = run.axis === 'weft', n = weft ? W : H;
  const first = Math.min(run.len, n - run.start), rest = run.len - first, rects = [];
  const mk = (s, l) => (weft ? { x: ox + s, y: oy + run.line, w: l, h: 1 } : { x: ox + run.line, y: oy + s, w: 1, h: l });
  rects.push(mk(run.start, first));
  if (rest > 0) rects.push(mk(0, rest));
  return rects;
}

function focusRun(run, ox = 0, oy = 0) {
  if (state.view.mode === 'original') state.view.mode = 'tile';
  const rects = runRects(run, ox, oy);
  const r = rects[0];
  renderView(false);
  view.zoomTo(r.x + r.w / 2, r.y + r.h / 2, Math.max(8, Math.min(24, 300 / Math.max(r.w, r.h))));
  view.setHighlights(rects);
  setStatus(`${run.axis} float L=${run.len} (${floatMm(run.len, state.params.epi).toFixed(2)} mm), colour #${run.colour}, ${run.axis === 'weft' ? 'pick' : 'end'} ${run.line}`);
}

function onPick(px, py) {
  if (state.view.mode === 'original') return setStatus(`Original pixel (${px}, ${py})`);
  const { W, H } = state.tile, tx = px % W, ty = py % H, ox = px - tx, oy = py - ty;
  const snap = state.view.compare === 'before' ? orig() : cur();
  const a = analysisFor(snap), i = ty * W + tx;
  const show = state.view.heat === 'off' ? 'both' : state.view.heat;
  for (const axis of show === 'both' ? ['weft', 'warp'] : [show]) {
    if (a.heat[axis][i] !== HEAT.VIOLATION) continue;
    const run = a.violatingRuns.find((r) => r.axis === axis && (axis === 'weft'
      ? r.line === ty && (tx - r.start + W) % W < r.len
      : r.line === tx && (ty - r.start + H) % H < r.len));
    if (run) return focusRun(run, ox, oy);
  }
  setStatus(`Pixel (${tx}, ${ty}) · colour #${snap.indices[i]}`);
}

function setStatus(t) { $('status').textContent = t; }

// ---------- view ----------
let view;
function renderView(fit) {
  const v = state.view;
  document.querySelectorAll('#viewMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === v.mode));
  document.querySelectorAll('#heatMode button').forEach((b) => b.classList.toggle('on', b.dataset.h === v.heat));
  document.querySelectorAll('#cmpMode button').forEach((b) => b.classList.toggle('on', b.dataset.c === v.compare));
  document.querySelectorAll('#viewMode button, #heatMode button, #cmpMode button').forEach((b) => { b.disabled = !state.hist && b.dataset.v !== 'original'; });
  document.querySelector('#viewMode [data-v=original]').disabled = !state.src;
  view.gridMajor = state.params.hookModule || 8;
  if (v.mode === 'original') {
    if (state.src) view.setImage(state.src.rgba, state.src.width, state.src.height, fit);
    else view.clear();
    return;
  }
  if (!state.hist) return view.clear();
  const snap = v.compare === 'before' ? orig() : cur();
  const { W, H } = state.tile;
  let rgba = indexedToRgba(snap.indices, snap.palette);
  if (v.heat !== 'off') rgba = applyHeat(rgba, analysisFor(snap), v.heat);
  const reps = v.mode === '3x3' ? [3, 3] : v.mode === 'body' ? [Math.max(1, Math.floor(state.params.hooks / W)), 1] : [1, 1];
  const t = reps[0] * reps[1] === 1 ? { rgba, width: W, height: H } : tileRgba(rgba, W, H, reps[0], reps[1]);
  view.setImage(t.rgba, t.width, t.height, fit);
}

// ---------- metrics + checklist ----------
function renderMetrics() {
  const el = $('metrics');
  if (!state.hist) { el.innerHTML = '<h2>Metrics</h2><p class="hint">Load an image to see float metrics.</p>'; return; }
  const b = analysisFor(orig()), a = analysisFor(cur()), p = state.params;
  const rows = [
    ['Violations', 'Runs longer than Lmax', 'violations', (x) => x.violations, 0],
    ['  weft', 'Horizontal runs over Lmax', '', (x) => x.weft.violations, 0],
    ['  warp', 'Vertical runs over Lmax', '', (x) => x.warp.violations, 0],
    ['Excess score', 'Sum of max(0, L − Lmax) over all runs', '', (x) => x.excess, 0],
    ['Max float', 'Longest run (ends/picks)', '', (x) => x.maxFloat, 0],
    ['Avg float', 'Mean run length', '', (x) => x.avgFloat, 2],
    ['Density %', 'Pixels inside violating runs ÷ (W×H) × 100', '', (x) => x.densityPct, 2],
  ];
  const f = (v, d) => (d ? v.toFixed(d) : String(v));
  let h = `<h2>Metrics</h2><table class="m"><tr><th></th><th title="Original quantized">Before</th><th title="Current state">After</th><th>Δ</th></tr>`;
  for (const [label, tip, , get, d] of rows) {
    const bv = get(b), av = get(a), dv = av - bv;
    h += `<tr title="${tip}"><td>${label}</td><td>${f(bv, d)}</td><td>${f(av, d)}</td><td class="${dv < 0 ? 'good' : dv > 0 ? 'bad' : ''}">${dv > 0 ? '+' : ''}${f(dv, d)}</td></tr>`;
  }
  h += `</table><p class="hint">Max float ${a.maxFloat} = ${floatMm(a.maxFloat, p.epi).toFixed(2)} mm (Lmax ${p.lmax} = ${floatMm(p.lmax, p.epi).toFixed(2)} mm)</p>`;
  // histogram of all counted runs (weft + warp)
  const hist = {};
  for (const ax of [a.weft, a.warp]) for (const [L, n] of Object.entries(ax.histogram)) hist[L] = (hist[L] || 0) + n;
  const maxL = Math.min(40, Math.max(...Object.keys(hist).map(Number), p.lmax));
  const peak = Math.max(1, ...Object.values(hist));
  h += `<div class="hist" title="Run-length histogram (weft + warp). Red bars exceed Lmax.">`;
  for (let L = 1; L <= maxL; L++) h += `<div class="${L > p.lmax ? 'over' : ''}" style="height:${Math.max(2, ((hist[L] || 0) / peak) * 100)}%" title="L=${L}: ${hist[L] || 0} runs"></div>`;
  h += '</div>';
  el.innerHTML = h;
}

function renderChecks() {
  const el = $('checks');
  if (!state.hist) { el.innerHTML = '<h2>Validator</h2><p class="hint">No design yet.</p>'; return; }
  const v = validationFor(cur());
  el.innerHTML = `<h2>Validator <span class="badge ${v.ok ? 'pass' : 'fail'}">${v.ok ? 'PASS' : 'FAIL'}</span></h2><ul class="checks">${v.checks.map((c) =>
    `<li><span class="badge ${c.skipped ? 'skip' : c.pass ? 'pass' : 'fail'}">${c.skipped ? 'N/A' : c.pass ? 'PASS' : 'FAIL'}</span><span>${c.label}<div class="d">${c.detail}</div></span></li>`).join('')}</ul>`;
}

function refresh(fit = false) {
  renderSteps();
  if (state.hist) { for (const s of [orig(), cur()]) analysisFor(s); }
  renderView(fit);
  renderMetrics(); renderChecks();
  $('undo').disabled = !state.hist || !state.hist.canUndo;
  $('redo').disabled = !state.hist || !state.hist.canRedo;
  $('revert').disabled = !state.hist || cur() === orig();
  view.setHighlights([]);
  fillLeft();
}

// ---------- init ----------
function init() {
  view = new CanvasView($('view'), { onPick: guard(onPick), onHover: (x, y, inside) => { if (inside && state.view.mode !== 'original' && state.tile) setStatus(`(${x % state.tile.W}, ${y % state.tile.H})`); } });
  document.querySelectorAll('#viewMode button').forEach((b) => { b.onclick = () => { state.view.mode = b.dataset.v; renderView(true); }; });
  document.querySelectorAll('#heatMode button').forEach((b) => { b.onclick = () => { state.view.heat = b.dataset.h; renderView(false); }; });
  document.querySelectorAll('#cmpMode button').forEach((b) => { b.onclick = () => { state.view.compare = b.dataset.c; renderView(false); }; });
  $('grid').onchange = () => view.setGrid($('grid').checked);
  $('fit').onclick = () => view.fit();
  $('undo').onclick = () => { state.hist.undo(); state.fixInfo = null; refresh(); };
  $('redo').onclick = () => { state.hist.redo(); refresh(); };
  $('revert').onclick = () => { state.hist.revert(); state.fixInfo = null; refresh(); };
  $('theme').onclick = () => {
    const r = document.documentElement, dark = getComputedStyle(r).getPropertyValue('--bg').trim() === '#14171d';
    r.dataset.theme = dark ? 'light' : 'dark';
    view.draw();
  };
  $('selftest').onclick = () => {
    const out = $('selftestOut'); out.style.display = 'block'; out.innerHTML = '<h2>Self-test</h2><p class="hint">Running…</p>';
    setTimeout(() => {
      const res = runSelfTests(), pass = res.filter((r) => r.ok).length;
      out.innerHTML = `<h2>Self-test <span class="badge ${pass === res.length ? 'pass' : 'fail'}">${pass}/${res.length}</span></h2><ul class="checks">${res.map((r) =>
        `<li><span class="badge ${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'}</span><span>${r.name}<div class="d">${r.ok ? r.info : r.error}</div></span></li>`).join('')}</ul>`;
    }, 30);
  };
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !state.hist) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    e.preventDefault(); if (e.shiftKey) $('redo').click(); else $('undo').click();
  });
  for (const ev of ['dragover', 'dragenter']) window.addEventListener(ev, (e) => { e.preventDefault(); const d = $('drop'); if (d) d.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); const d = $('drop'); if (d) d.classList.remove('over'); });
  window.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f).catch((err) => showError(err.message)); });
  renderSteps(); renderLeft(); refresh(true);
}

init();
