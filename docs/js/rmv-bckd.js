// docs/js/rmv-bckd.js
// Pure helpers for background removal (no DOM, no globals).
// Exposes window.BGR with: sampleCornerColors, dedupeColors, process

(function () {
  'use strict';

  function sampleCornerColors(img) {
    const w = img.width, h = img.height, off = 2;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);

    const px = (x, y) => {
      const d = cx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return [
      { rgb: px(off, off), corners: new Set(['tl']) },
      { rgb: px(w - 1 - off, off), corners: new Set(['tr']) },
      { rgb: px(off, h - 1 - off), corners: new Set(['bl']) },
      { rgb: px(w - 1 - off, h - 1 - off), corners: new Set(['br']) }
    ];
  }

  function dedupeColors(samples, thresh = 12) {
    const t2 = thresh * thresh;
    const groups = [];
    const d2 = (a, b) => {
      const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
      return dr * dr + dg * dg + db * db;
    };
    for (const s of samples) {
      let g = groups.find(g => d2(g.rgb, s.rgb) <= t2);
      if (g) { s.corners.forEach(c => g.corners.add(c)); }
      else groups.push({ rgb: s.rgb, corners: new Set([...s.corners]) });
    }
    return groups;
  }

  function _applyMaskToImage(pixels, mask) {
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      pixels[i + 3] = Math.min(pixels[i + 3], mask[j]);
    }
  }

  function _erodeMask(mask, w, h, iterations = 1) {
    const tmp = new Uint8ClampedArray(mask.length);
    for (let it = 0; it < iterations; it++) {
      tmp.set(mask);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (tmp[i] === 0) { mask[i] = 0; continue; }
          if (
            tmp[i - 1] === 0 || tmp[i + 1] === 0 || tmp[i - w] === 0 || tmp[i + w] === 0 ||
            tmp[i - w - 1] === 0 || tmp[i - w + 1] === 0 || tmp[i + w - 1] === 0 || tmp[i + w + 1] === 0
          ) mask[i] = 0;
        }
      }
    }
  }

  function _blurMask(mask, w, h, radius = 1) {
    if (radius <= 0) return;
    const tmp = new Float32Array(mask.length);
    const r = Math.round(radius);

    // horizontal
    for (let y = 0; y < h; y++) {
      let sum = 0, row = y * w;
      for (let x = -r; x <= r; x++) sum += mask[row + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / (2 * r + 1);
        const add = x + r + 1, sub = x - r;
        sum += mask[row + Math.min(w - 1, Math.max(0, add))];
        sum -= mask[row + Math.max(0, sub)];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) {
        const idx = y * w + x;
        mask[idx] = Math.round(sum / (2 * r + 1));
        const add = y + r + 1, sub = y - r;
        sum += tmp[Math.min(h - 1, Math.max(0, add)) * w + x];
        sum -= tmp[Math.max(0, sub) * w + x];
      }
    }
  }

  function _makeMaskThresholdTarget(pixels, w, h, tol, outMask, targetRGB) {
    const tol2 = Math.pow((tol / 100) * 255, 2);
    const [tr, tg, tb] = targetRGB;
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const d2 = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
      outMask[j] = (d2 < tol2) ? 0 : 255;
    }
  }

  function _makeMaskWandSeeds(pixels, w, h, tol, outMask, target) {
    outMask.fill(255);
    const tol2 = Math.pow((tol / 100) * 255, 2);
    const visited = new Uint8Array(w * h);
    const q = [];
    const idxOf = { tl: 0, tr: w - 1, bl: (h - 1) * w, br: w * h - 1 };
    const [tr, tg, tb] = target.rgb;

    target.corners.forEach(c => {
      const idx = idxOf[c];
      if (idx != null) q.push(idx);
    });

    while (q.length) {
      const idx = q.pop();
      if (visited[idx]) continue;
      visited[idx] = 1;

      const i4 = idx * 4;
      const r = pixels[i4], g = pixels[i4 + 1], b = pixels[i4 + 2];
      const d2 = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
      if (d2 >= tol2) continue;

      outMask[idx] = 0;

      const x = idx % w, y = (idx / w) | 0;
      if (x > 0) q.push(idx - 1);
      if (x < w - 1) q.push(idx + 1);
      if (y > 0) q.push(idx - w);
      if (y < h - 1) q.push(idx + w);
    }
  }

  // Main processor: returns a <canvas> with the masked image (or null if mode='none' or no target)
  function process({ img, mode = 'none', tol = 40, feather = 1, selected }) {
    if (!img || mode === 'none' || !selected) return null;

    const w = img.width, h = img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const imgData = cx.getImageData(0, 0, w, h);
    const mask = new Uint8ClampedArray(w * h);

    if (mode === 'threshold') {
      _makeMaskThresholdTarget(imgData.data, w, h, tol, mask, selected.rgb);
    } else {
      _makeMaskWandSeeds(imgData.data, w, h, tol, mask, selected);
    }

    _erodeMask(mask, w, h, 1);
    if (feather > 0) _blurMask(mask, w, h, feather);
    _applyMaskToImage(imgData.data, mask);
    cx.putImageData(imgData, 0, 0);
    return c;
  }

  window.BGR = { sampleCornerColors, dedupeColors, process };
})();
