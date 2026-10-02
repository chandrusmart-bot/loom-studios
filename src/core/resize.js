// Resampling for RGBA images (Uint8ClampedArray/Uint8Array, 4 bytes per pixel).

/** Composite RGBA onto an opaque background (default white); returns new RGBA. */
export function flattenAlpha(rgba, bg = [255, 255, 255]) {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = Math.round(rgba[i] * a + bg[0] * (1 - a));
    out[i + 1] = Math.round(rgba[i + 1] * a + bg[1] * (1 - a));
    out[i + 2] = Math.round(rgba[i + 2] * a + bg[2] * (1 - a));
    out[i + 3] = 255;
  }
  return out;
}

export function resizeNearest(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      const s = (sy * sw + sx) * 4, d = (y * dw + x) * 4;
      out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
    }
  }
  return out;
}

// Per-destination-cell list of [srcIndex, weight] spans for box filtering.
function spans(sn, dn) {
  const scale = sn / dn;
  const res = [];
  for (let d = 0; d < dn; d++) {
    const a = d * scale, b = (d + 1) * scale;
    const list = [];
    for (let s = Math.floor(a); s < Math.min(sn, Math.ceil(b)); s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 1e-9) list.push([s, w / scale]);
    }
    res.push(list);
  }
  return res;
}

/** Area-average (box) resampling with exact fractional coverage. */
export function resizeArea(src, sw, sh, dw, dh) {
  const xs = spans(sw, dw), ys = spans(sh, dh);
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [sy, wy] of ys[y]) {
        for (const [sx, wx] of xs[x]) {
          const w = wx * wy, s = (sy * sw + sx) * 4;
          r += src[s] * w; g += src[s + 1] * w; b += src[s + 2] * w; a += src[s + 3] * w;
        }
      }
      const d = (y * dw + x) * 4;
      out[d] = Math.round(r); out[d + 1] = Math.round(g);
      out[d + 2] = Math.round(b); out[d + 3] = Math.round(a);
    }
  }
  return out;
}

export function resize(src, sw, sh, dw, dh, mode = 'area') {
  if (sw === dw && sh === dh) return Uint8Array.from(src);
  return mode === 'nearest' ? resizeNearest(src, sw, sh, dw, dh) : resizeArea(src, sw, sh, dw, dh);
}
