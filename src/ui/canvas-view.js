// Pixel-perfect zoom/pan canvas with hook/pick rulers, grid and highlights. DOM only.

const RULER = 22;

export class CanvasView {
  constructor(canvas, { onPick, onHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick || (() => {});
    this.onHover = onHover || (() => {});
    this.off = document.createElement('canvas');
    this.iw = 0; this.ih = 0;
    this.zoom = 1; this.ox = 0; this.oy = 0;
    this.grid = false; this.gridMajor = 8;
    this.highlights = [];
    this.xLabel = 'hooks'; this.yLabel = 'picks';
    this._bind();
    new ResizeObserver(() => { this._resize(); this.draw(); }).observe(canvas.parentElement);
    this._resize();
  }

  _css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  _resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(100, Math.floor(r.width));
    this.h = Math.max(100, Math.floor(r.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
  }

  /** Replace the displayed image. fit = refit view (use when size changes). */
  setImage(rgba, w, h, fit = false) {
    const sizeChanged = w !== this.iw || h !== this.ih;
    this.iw = w; this.ih = h;
    this.off.width = w; this.off.height = h;
    this.off.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    if (fit || sizeChanged) this.fit(); else this.draw();
  }

  clear() { this.iw = this.ih = 0; this.draw(); }

  fit() {
    if (!this.iw) return this.draw();
    const aw = this.w - RULER, ah = this.h - RULER;
    const z = Math.max(0.05, Math.min(aw / this.iw, ah / this.ih));
    this.zoom = z >= 1 ? Math.floor(z) || 1 : z; // integer zoom when upscaling keeps pixels crisp
    this.ox = (aw - this.iw * this.zoom) / 2;
    this.oy = (ah - this.ih * this.zoom) / 2;
    this.draw();
  }

  setGrid(on) { this.grid = on; this.draw(); }
  setHighlights(rects) { this.highlights = rects || []; this.draw(); }

  zoomTo(x, y, z = 12) {
    this.zoom = z;
    this.ox = (this.w - RULER) / 2 - x * z;
    this.oy = (this.h - RULER) / 2 - y * z;
    this.draw();
  }

  toImage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [
      Math.floor((clientX - r.left - RULER - this.ox) / this.zoom),
      Math.floor((clientY - r.top - RULER - this.oy) / this.zoom),
    ];
  }

  _bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, moved: false };
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { this.ox = drag.ox + dx; this.oy = drag.oy + dy; this.draw(); }
      }
      const [px, py] = this.toImage(e.clientX, e.clientY);
      this.onHover(px, py, px >= 0 && py >= 0 && px < this.iw && py < this.ih);
    });
    c.addEventListener('pointerup', (e) => {
      c.classList.remove('dragging');
      if (drag && !drag.moved) {
        const [px, py] = this.toImage(e.clientX, e.clientY);
        if (px >= 0 && py >= 0 && px < this.iw && py < this.ih) this.onPick(px, py);
      }
      drag = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const mx = e.clientX - r.left - RULER, my = e.clientY - r.top - RULER;
      const f = e.deltaY < 0 ? 1.25 : 0.8;
      const nz = Math.max(0.05, Math.min(80, this.zoom * f));
      this.ox = mx - (mx - this.ox) * (nz / this.zoom);
      this.oy = my - (my - this.oy) * (nz / this.zoom);
      this.zoom = nz;
      this.draw();
    }, { passive: false });
  }

  _niceStep(minPx) {
    const raw = minPx / this.zoom;
    for (const s of [1, 2, 5, 10, 20, 40, 50, 100, 200, 500, 1000, 2000]) if (s >= raw) return s;
    return 5000;
  }

  draw() {
    const { ctx, dpr, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this._css('--canvas-bg') || '#ccc';
    ctx.fillRect(0, 0, w, h);
    if (!this.iw) return;

    ctx.save();
    ctx.beginPath(); ctx.rect(RULER, RULER, w - RULER, h - RULER); ctx.clip();
    ctx.translate(RULER + this.ox, RULER + this.oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, this.iw * this.zoom, this.ih * this.zoom);

    if (this.grid && this.zoom >= 6) {
      const z = this.zoom, iw = this.iw, ih = this.ih;
      ctx.lineWidth = 1;
      for (const major of [false, true]) {
        ctx.strokeStyle = this._css(major ? '--grid-major' : '--grid');
        ctx.beginPath();
        for (let x = 0; x <= iw; x++) if ((x % this.gridMajor === 0) === major) { ctx.moveTo(x * z + .5, 0); ctx.lineTo(x * z + .5, ih * z); }
        for (let y = 0; y <= ih; y++) if ((y % this.gridMajor === 0) === major) { ctx.moveTo(0, y * z + .5); ctx.lineTo(iw * z, y * z + .5); }
        ctx.stroke();
      }
    }
    ctx.strokeStyle = this._css('--hl'); ctx.lineWidth = 2;
    for (const r of this.highlights) ctx.strokeRect(r.x * this.zoom, r.y * this.zoom, r.w * this.zoom, r.h * this.zoom);
    ctx.restore();

    this._rulers();
  }

  _rulers() {
    const { ctx, w, h } = this;
    ctx.fillStyle = this._css('--ruler'); ctx.fillRect(0, 0, w, RULER); ctx.fillRect(0, 0, RULER, h);
    ctx.fillStyle = this._css('--muted'); ctx.strokeStyle = this._css('--muted');
    ctx.font = '10px system-ui'; ctx.lineWidth = 1;
    const step = this._niceStep(48);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let x = 0; x <= this.iw; x += step) {
      const sx = RULER + this.ox + x * this.zoom;
      if (sx < RULER || sx > w) continue;
      ctx.beginPath(); ctx.moveTo(sx + .5, RULER - 6); ctx.lineTo(sx + .5, RULER); ctx.stroke();
      ctx.fillText(String(x), sx + 3, 8);
    }
    for (let y = 0; y <= this.ih; y += step) {
      const sy = RULER + this.oy + y * this.zoom;
      if (sy < RULER || sy > h) continue;
      ctx.beginPath(); ctx.moveTo(RULER - 6, sy + .5); ctx.lineTo(RULER, sy + .5); ctx.stroke();
      ctx.save(); ctx.translate(8, sy + 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(String(y), 0, 0); ctx.restore();
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(this.xLabel, w - 4, 12 > RULER ? 0 : 0);
    ctx.textAlign = 'left'; ctx.fillText(this.yLabel, 2, h - 12);
  }
}
