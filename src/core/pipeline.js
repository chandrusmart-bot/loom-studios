// Image pipeline: RGBA source -> indexed tile. Pure; shared by UI, tests, self-test.
import { correctedHeight, bppForColours } from './params.js';
import { flattenAlpha, resize } from './resize.js';
import { quantize } from './quantize.js';
import { despeckle } from './despeckle.js';
import { edgeBlend, mirror, enforceSeam } from './seamless.js';

export const MAX_SOURCE_PIXELS = 50e6;

export const DEFAULT_SETTINGS = Object.freeze({
  resizeMode: 'area',     // 'area' | 'nearest'
  lockAspect: true,       // false => use settings.height
  height: null,
  dither: 'none',         // 'none' | 'ordered'
  seamless: 'off',        // 'off' | 'blend' | 'mirror'
  blendBand: 8,
  despeckle: true,
  background: null,       // [r,g,b] to force index 0
});

/** Throws a user-readable Error for unusable input. */
export function checkInput(src, params) {
  if (!src || !src.width || !src.height || !src.rgba) throw new Error('No image loaded.');
  if (src.width * src.height > MAX_SOURCE_PIXELS) {
    throw new Error(`Image is too large (${(src.width * src.height / 1e6).toFixed(0)} MP; limit ${MAX_SOURCE_PIXELS / 1e6} MP). Downscale it first.`);
  }
  if (!(params.colours >= 1)) throw new Error('Colour count must be at least 1.');
  if (!bppForColours(params.colours)) throw new Error('Colour count must be 256 or fewer.');
  if (!(params.tileWidth >= 1)) throw new Error('Tile width must be at least 1.');
  if (!(params.epi > 0 && params.ppi > 0)) throw new Error('EPI and PPI must be positive.');
}

/**
 * src: { width, height, rgba }. Returns { indices, palette, W, H, seamless }.
 * Order: flatten alpha, resize, seamless pre-process (on colour), quantize,
 * despeckle, then force identical opposite edges when seamless.
 */
export function buildTile(src, params, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  checkInput(src, params);
  const W = params.tileWidth;
  const H = s.lockAspect || !s.height ? correctedHeight(src.width, src.height, W, params) : Math.max(1, Math.round(s.height));
  let rgba = resize(flattenAlpha(src.rgba), src.width, src.height, W, H, s.resizeMode);
  const seamless = s.seamless !== 'off';
  if (s.seamless === 'blend') rgba = edgeBlend(rgba, W, H, s.blendBand, 4);
  else if (s.seamless === 'mirror') rgba = mirror(rgba, W, H, 4);
  const q = quantize(rgba, W, H, params.colours, { dither: s.dither, background: s.background });
  let indices = s.despeckle ? despeckle(q.indices, W, H, params.minFeature, seamless) : q.indices;
  if (seamless) indices = enforceSeam(indices, W, H);
  return { indices, palette: q.palette, W, H, seamless };
}
