// RGBA renderers for the canvas views and PNG export. Pure.
import { HEAT } from './analyze.js';
import { tileIndexed } from './seamless.js';

export function indexedToRgba(indices, palette) {
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const c = palette[indices[i]] || [255, 0, 255];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

export const HEAT_COLOURS = Object.freeze({
  [HEAT.OK]: [40, 190, 90],
  [HEAT.NEAR]: [245, 170, 20],
  [HEAT.VIOLATION]: [230, 40, 40],
});

/**
 * Blend a heat overlay over an RGBA image. mode: 'weft' | 'warp' | 'both'
 * ('both' shows the worse of the two). alpha 0..1.
 */
export function applyHeat(rgba, analysis, mode = 'both', alpha = 0.6) {
  const out = Uint8ClampedArray.from(rgba);
  const hw = analysis.heat.weft, hp = analysis.heat.warp;
  for (let i = 0; i < hw.length; i++) {
    const level = mode === 'weft' ? hw[i] : mode === 'warp' ? hp[i] : Math.max(hw[i], hp[i]);
    const c = HEAT_COLOURS[level];
    if (!c) continue;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = out[i * 4 + k] * (1 - alpha) + c[k] * alpha;
  }
  return out;
}

/** Render a repeated preview (nx × ny tiles). Returns { rgba, width, height }. */
export function repeatPreview(indices, palette, W, H, nx, ny) {
  return { rgba: indexedToRgba(tileIndexed(indices, W, H, nx, ny), palette), width: W * nx, height: H * ny };
}

/** Tile an RGBA image nx × ny. */
export function tileRgba(rgba, W, H, nx, ny) {
  const OW = W * nx;
  const out = new Uint8ClampedArray(OW * H * ny * 4);
  for (let y = 0; y < H * ny; y++) {
    const row = (y % H) * W * 4;
    for (let tx = 0; tx < nx; tx++) out.set(rgba.subarray(row, row + W * 4), (y * OW + tx * W) * 4);
  }
  return { rgba: out, width: OW, height: H * ny };
}
