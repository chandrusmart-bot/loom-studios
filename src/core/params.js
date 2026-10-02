// Loom parameters, presets and derived values. Pure, no DOM.

export const DEFAULTS = Object.freeze({
  hooks: 960,
  tileWidth: 120,
  hookModule: 8,
  epi: 80,
  ppi: 80,
  lmax: 7,
  minFeature: 2,
  colours: 6,
});

export const PRESETS = Object.freeze({
  meena: { label: 'Meena', colours: 6, note: '5 colours + background, 4-bpp' },
  single: { label: 'Single colour', colours: 2, note: '2 colours, 1-bpp' },
});

export function makeParams(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

export function applyPreset(params, name) {
  const p = PRESETS[name];
  if (!p) throw new Error(`Unknown preset: ${name}`);
  return { ...params, colours: p.colours };
}

export function repeats(p) {
  return p.hooks / p.tileWidth;
}

export function repeatsIsInteger(p) {
  return p.tileWidth > 0 && p.hooks % p.tileWidth === 0;
}

export function floatMm(L, epi) {
  return (L / epi) * 25.4;
}

/** Bits per pixel for a colour count (incl. background), or null if > 256. */
export function bppForColours(n) {
  if (n < 1) return null;
  if (n <= 2) return 1;
  if (n <= 16) return 4;
  if (n <= 256) return 8;
  return null;
}

/** Tile height that preserves physical proportions given EPI (x) and PPI (y). */
export function correctedHeight(srcW, srcH, tileW, p) {
  return Math.max(1, Math.round((srcH / srcW) * tileW * (p.ppi / p.epi)));
}

/** BMP row size in bytes: rows padded to 4-byte boundaries. */
export function bmpRowSize(bpp, width) {
  return Math.floor((bpp * width + 31) / 32) * 4;
}
