// app.js 
(() => {
  'use strict';

  // ===== Elements =====
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const blankSelect = document.getElementById('blankSelect');
  const artInput = document.getElementById('artFile');
  const artBtn = document.getElementById('artFileBtn');
  const artNameEl = document.getElementById('artFileName');
  const centerBtn = document.getElementById('centerBtn');
  const fitBtn = document.getElementById('fitBtn');
  const sizeReadout = document.getElementById('sizeReadout');
  const bgScopeBtn = document.getElementById('bgScopeBtn');
  const cropToggleBtn = document.getElementById('cropToggleBtn');
  const cropResetBtn = document.getElementById('cropResetBtn');

  const sideFrontBtn = document.getElementById('qtSideFront');
  const sideBackBtn = document.getElementById('qtSideBack');

  // ===== Public order state =====
  window.orderState = window.orderState || {};
  if (!window.orderState.activeSide) window.orderState.activeSide = 'front'; // default

  window.orderState.sides = window.orderState.sides || {};

  function ensureSide(side) {
    if (!window.orderState.sides[side]) {
      window.orderState.sides[side] = {
        fileId: '',
        designLabel: '',
        readoutIn: null,
        tierIn: null,
        currentTier: null,
        bgEnabled: false,
        bgMode: 'edge',
        crop: null,
        cropMode: false
      };
    }
    return window.orderState.sides[side];
  }

  function defaultArtPose() {
    return { tx: 1400 * 0.5, ty: 1600 * 0.45, scale: 0.5 }; // uses your STAGE constants
  }

  function snapshotSide(side) {
    const slot = ensureSide(side);
    Object.assign(slot, {
      artImg: state.artImg || null,
      processedArt: processedArt || null,
      art: { ...state.art },
      bgSel: BG_SELECTED || null,
      bgEnabled: BG.enabled || false,
      bgMode: BG.mode || 'edge',
      crop: crop ? { ...crop } : null,
      cropMode: cropMode
    });
  }

  function restoreSide(side) {
    const saved = ensureSide(side);
    if (saved) {
      state.artImg = saved.artImg || null;
      processedArt = saved.processedArt || null;
      state.art = saved.art ? { ...saved.art } : defaultArtPose();
      BG_SELECTED = saved.bgSel || null;
      BG.enabled = !!saved.bgEnabled;
      BG.mode = saved.bgMode || 'edge';
      crop = saved.crop ? { ...saved.crop } : null;
      cropMode = !!saved.cropMode;
    } else {
      state.artImg = null;
      processedArt = null;
      state.art = defaultArtPose();
      BG_SELECTED = null;
      BG.enabled = false;
      BG.mode = 'edge';
      crop = null;
      cropMode = false;
    }
    updateBgButton();
    updateBgScopeButton();
    updateCropButtons();
    if (BG.enabled && state.artImg && !processedArt) rebuildProcessedArt();
    else scheduleDraw();
  }

  // ===== Constants =====
  const STAGE = { w: 1400, h: 1600 };
  const MAX_IN = { w: 11.7, h: 16.5 };
  const PPI_HINT = 80;
  const SAFETY = 40;
  const FIT_PAD = 0;
  const CLAMP_EPS_PX = 0.5;
  const CROP_MIN = 20;
  const HANDLE_HIT = 18;

  const DESIRED_W = Math.round(MAX_IN.w * PPI_HINT);
  const DESIRED_H = Math.round(MAX_IN.h * PPI_HINT);

  const PRINT = {
    w: Math.min(DESIRED_W, STAGE.w - SAFETY * 2),
    h: Math.min(DESIRED_H, STAGE.h - SAFETY * 2)
  };
  PRINT.x = Math.round((STAGE.w - PRINT.w) / 2);
  PRINT.y = Math.max(SAFETY, Math.round((STAGE.h - PRINT.h) / 2 - STAGE.h * 0.06));

  // ===== BG removal state =====
  const bgRemoveBtn = document.getElementById('bgRemoveBtn');

  const BG = { enabled: false, tol: 32, feather: 1, mode: 'edge' }; // mode: 'edge' | 'global'
  let BG_SELECTED = null;
  let processedArt = null;
  let crop = null;            // { x, y, w, h } in image px
  let cropMode = false;
  let cropDrag = null;

  // ===== App state =====
  const state = {
    blank: null,
    artImg: null,
    art: { tx: STAGE.w * 0.5, ty: STAGE.h * 0.45, scale: 0.5 },
    dragging: false,
    dragMode: 'move',
    last: { x: 0, y: 0 },
    dpr: Math.min(window.devicePixelRatio || 1, 1.75),
  };

  // Manifest + print box derived from blank
  let MANIFEST = null;
  let PPI_STAGE = null;
  let BOX_PX = null;

  // ===== rAF scheduler =====
  let needsDraw = false;
  function scheduleDraw() {
    if (needsDraw) return;
    needsDraw = true;
    requestAnimationFrame(() => {
      needsDraw = false;
      draw();
      updateReadout();
    });
  }

  function refitFitline(el) {
    if (!el) return;
    if (typeof window !== 'undefined' && typeof window.fitlineOne === 'function') {
      window.fitlineOne(el);
    }
  }

  function updateBgButton() {
    if (!bgRemoveBtn) return;
    bgRemoveBtn.textContent = BG.enabled ? 'Restore' : 'Remove';
    bgRemoveBtn.dataset.active = BG.enabled ? 'true' : 'false';
  }

  function updateBgScopeButton() {
    if (!bgScopeBtn) return;
    bgScopeBtn.textContent = BG.mode === 'edge' ? 'Edge only' : 'Everywhere';
    bgScopeBtn.title = (BG.mode === 'edge')
      ? 'Remove background only from edges (keeps interior whites)'
      : 'Remove matching white everywhere (may remove interior whites)';
    bgScopeBtn.dataset.active = BG.enabled ? 'true' : 'false';
    bgScopeBtn.disabled = !BG.enabled;
  }

  function updateCropButtons() {
    const hasArt = !!state.artImg;
    if (cropToggleBtn) {
      cropToggleBtn.textContent = cropMode ? 'Done cropping' : 'Edit crop';
      cropToggleBtn.disabled = !hasArt;
    }
    if (cropResetBtn) {
      cropResetBtn.disabled = !hasArt;
    }
  }

  // ===== Helpers =====
  const area = () => (BOX_PX || PRINT);

  const srcImage = () => (processedArt || state.artImg);

  function fullCropRect() {
    const src = state.artImg;
    if (!src) return null;
    return { x: 0, y: 0, w: src.width, h: src.height };
  }

  function clampCropRect(rect) {
    const src = state.artImg;
    if (!src || !rect) return fullCropRect();
    let { x, y, w, h } = rect;
    const maxW = src.width, maxH = src.height;
    w = Math.max(CROP_MIN, Math.min(w, maxW));
    h = Math.max(CROP_MIN, Math.min(h, maxH));
    x = Math.max(0, Math.min(x, maxW - w));
    y = Math.max(0, Math.min(y, maxH - h));
    return { x, y, w, h };
  }

  function currentCrop() {
    if (!state.artImg) return null;
    if (!crop) crop = fullCropRect();
    crop = clampCropRect(crop);
    return crop;
  }

  function resetCrop() {
    crop = fullCropRect();
    scheduleDraw();
    updateCropButtons();
  }

  function getDimsPx() {
    const c = currentCrop();
    if (c) return { w: c.w, h: c.h };
    if (state.artImg) return { w: state.artImg.width, h: state.artImg.height };
    return null;
  }

  function setCanvasSize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const aspect = STAGE.w / STAGE.h;

    let targetW = cssW;
    let targetH = cssW / aspect;
    if (targetH > cssH) { targetH = cssH; targetW = cssH * aspect; }

    canvas.width = Math.round(targetW * state.dpr);
    canvas.height = Math.round(targetH * state.dpr);
    canvas.style.width = `${Math.round(targetW)}px`;
    canvas.style.height = `${Math.round(targetH)}px`;

    scheduleDraw();
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  function toStageXY(evt) {
    const r = canvas.getBoundingClientRect();
    const xCss = evt.clientX - r.left;
    const yCss = evt.clientY - r.top;
    const s = (canvas.width / state.dpr) / STAGE.w;
    return { x: xCss / s, y: yCss / s };
  }

  function pointInArt(x, y) {
    if (!state.artImg) return false;
    const dims = getDimsPx();
    if (!dims) return false;
    const hw = (dims.w * state.art.scale) / 2;
    const hh = (dims.h * state.art.scale) / 2;
    return (x >= state.art.tx - hw && x <= state.art.tx + hw &&
      y >= state.art.ty - hh && y <= state.art.ty + hh);
  }

  function maxScaleForPrintArea(imgW, imgH) {
    const a = area();
    const sx = a.w / imgW;
    const sy = a.h / imgH;
    return Math.min(sx, sy) * (1 - FIT_PAD);
  }

  function enforceConstraints() {
    const dims = getDimsPx();
    if (!state.artImg || !dims) return;
    const cap = maxScaleForPrintArea(dims.w, dims.h);
    const epsScale = CLAMP_EPS_PX / dims.w;
    state.art.scale = Math.min(state.art.scale, cap - epsScale);

    const a = area();
    const halfW = (dims.w * state.art.scale) / 2;
    const halfH = (dims.h * state.art.scale) / 2;

    const minX = a.x + halfW, maxX = a.x + a.w - halfW;
    const minY = a.y + halfH, maxY = a.y + a.h - halfH;

    state.art.tx = Math.min(Math.max(state.art.tx, minX), maxX);
    state.art.ty = Math.min(Math.max(state.art.ty, minY), maxY);
  }

  function getArtSizeInches() {
    if (!state.artImg || !PPI_STAGE) return null;
    const dims = getDimsPx();
    if (!dims) return null;
    const w_px = dims.w * state.art.scale;
    const h_px = dims.h * state.art.scale;
    return { w_in: w_px / PPI_STAGE, h_in: h_px / PPI_STAGE };
  }

  function updateReadout() {
    if (!sizeReadout) return;
    const setSizeText = (txt) => {
      sizeReadout.textContent = `Art Size: ${txt}`;
      refitFitline(sizeReadout);
    };

    const s = getArtSizeInches();
    window.orderState.readoutIn = s || null;

    if (s) {
      setSizeText(`${s.w_in.toFixed(2)}" W × ${s.h_in.toFixed(2)}" H`);
    } else {
      setSizeText('—');
    }

    if (s && typeof window.deriveDtfTier === 'function') {
      window.orderState.currentTier = window.deriveDtfTier(s); // { tierIn, key, tooLarge }
      const side = window.orderState.activeSide || 'front';
      const slot = ensureSide(side);
      slot.readoutIn = s;
      slot.currentTier = window.orderState.currentTier;
      slot.tierIn = window.orderState.currentTier?.tierIn ?? null;
    }

    const placeBtn = document.getElementById('qtPlaceBtn');
    if (window.orderState?.currentTier?.tooLarge) {
      setSizeText(`Too large for DTF — max 16"`);
      sizeReadout.classList.add('error');
      if (placeBtn) placeBtn.disabled = true;
    } else {
      sizeReadout.classList.remove('error');
      if (placeBtn) placeBtn.disabled = false;
    }
  }

  // ===== Rendering =====
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const s = (canvas.width / state.dpr) / STAGE.w;
    ctx.scale(s * state.dpr, s * state.dpr);

    // Shirt
    if (state.blank) {
      const bw = state.blank.width, bh = state.blank.height;
      const sb = Math.min(STAGE.w / bw, STAGE.h / bh);
      const w = bw * sb, h = bh * sb;
      const x = (STAGE.w - w) / 2, y = (STAGE.h - h) / 2;
      ctx.drawImage(state.blank, x, y, w, h);
    }

    // Print guide while dragging
    if (state.dragging) {
      const a = area();
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(140,140,140,0.95)';
      ctx.strokeRect(a.x, a.y, a.w, a.h);
      ctx.restore();
    }

    // Art
    if (state.artImg) {
      if (!cropDrag) enforceConstraints();
      const src = processedArt || state.artImg;
      const c = currentCrop();
      const sx = c ? c.x : 0;
      const sy = c ? c.y : 0;
      const sw = c ? c.w : src.width;
      const sh = c ? c.h : src.height;
      const w = sw * state.art.scale;
      const h = sh * state.art.scale;

      ctx.save();
      ctx.translate(state.art.tx, state.art.ty);
      ctx.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
      ctx.restore();

      if (cropMode && c) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeRect(state.art.tx - w / 2, state.art.ty - h / 2, w, h);
        ctx.setLineDash([]);
        const hs = 10;
        const handles = [
          { x: state.art.tx - w / 2, y: state.art.ty - h / 2 },
          { x: state.art.tx + w / 2, y: state.art.ty - h / 2 },
          { x: state.art.tx - w / 2, y: state.art.ty + h / 2 },
          { x: state.art.tx + w / 2, y: state.art.ty + h / 2 }
        ];
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        handles.forEach(pt => {
          ctx.fillRect(pt.x - hs / 2, pt.y - hs / 2, hs, hs);
          ctx.strokeRect(pt.x - hs / 2, pt.y - hs / 2, hs, hs);
        });
        ctx.restore();
      }
    }
  }

  // ===== Actions =====
  function placeArtTopMaxWidth() {
    if (!state.artImg) return;
    const dims = getDimsPx();
    if (!dims) return;
    const cap = maxScaleForPrintArea(dims.w, dims.h);
    const epsScale = CLAMP_EPS_PX / dims.w;
    state.art.scale = cap - epsScale;

    const a = area();
    const scaledH = dims.h * state.art.scale;
    state.art.tx = a.x + a.w / 2;
    state.art.ty = a.y + scaledH / 2;
    enforceConstraints();
    scheduleDraw();
  }

  function centerArt() {
    const a = area();
    state.art.tx = a.x + a.w / 2;
    state.art.ty = a.y + a.h / 2;
    enforceConstraints();
    scheduleDraw();
  }

  const fitArtToMaxArea = () => placeArtTopMaxWidth();

  // ===== BG tools =====
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

  function pickAutoBgTarget(img) {
    if (!img) return null;
    const groups = dedupeColors(sampleCornerColors(img), 12);
    if (!groups.length) return null;
    const brightness = (rgb) => rgb[0] + rgb[1] + rgb[2];
    return groups.reduce((best, g) => brightness(g.rgb) > brightness(best.rgb) ? g : best, groups[0]);
  }

  function applyMaskToImage(pixels, mask) {
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      pixels[i + 3] = Math.min(pixels[i + 3], mask[j]);
    }
  }

  function erodeMask(mask, w, h, iterations = 1) {
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

  function blurMask(mask, w, h, radius = 1) {
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

  function makeMaskThresholdTarget(pixels, w, h, tol, outMask, targetRGB) {
    const tol2 = Math.pow((tol / 100) * 255, 2);
    const [tr, tg, tb] = targetRGB;
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const d2 = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
      outMask[j] = (d2 < tol2) ? 0 : 255;
    }
  }

  function makeMaskWandSeeds(pixels, w, h, tol, outMask, target) {
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

  function rebuildProcessedArt() {
    processedArt = null;
    if (!state.artImg || !BG.enabled) { scheduleDraw(); return; }
    if (!BG_SELECTED) BG_SELECTED = pickAutoBgTarget(state.artImg);
    if (!BG_SELECTED) { scheduleDraw(); return; }

    const src = state.artImg;
    const w = src.width, h = src.height;

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(src, 0, 0);

    const imgData = cx.getImageData(0, 0, w, h);
    const mask = new Uint8ClampedArray(w * h);

    if (BG.mode === 'edge') {
      makeMaskWandSeeds(imgData.data, w, h, BG.tol, mask, BG_SELECTED);
    } else {
      makeMaskThresholdTarget(imgData.data, w, h, BG.tol, mask, BG_SELECTED.rgb);
    }

    erodeMask(mask, w, h, 1);
    if (BG.feather > 0) blurMask(mask, w, h, BG.feather);

    applyMaskToImage(imgData.data, mask);
    cx.putImageData(imgData, 0, 0);
    processedArt = c;

    scheduleDraw();
  }

  // ===== Crop helpers =====
  function cropBoxOnStage() {
    const dims = getDimsPx();
    if (!state.artImg || !dims) return null;
    const w = dims.w * state.art.scale;
    const h = dims.h * state.art.scale;
    return { x: state.art.tx - w / 2, y: state.art.ty - h / 2, w, h };
  }

  function imgPointToStage(imgX, imgY, rect, scale, tx, ty) {
    const w = rect.w * scale;
    const h = rect.h * scale;
    const ox = tx - w / 2;
    const oy = ty - h / 2;
    return {
      x: ox + (imgX - rect.x) * scale,
      y: oy + (imgY - rect.y) * scale
    };
  }

  function hitCropHandle(pt) {
    const box = cropBoxOnStage();
    if (!box) return null;
    const handles = {
      nw: { x: box.x, y: box.y },
      ne: { x: box.x + box.w, y: box.y },
      sw: { x: box.x, y: box.y + box.h },
      se: { x: box.x + box.w, y: box.y + box.h }
    };
    for (const [key, pos] of Object.entries(handles)) {
      const dx = pt.x - pos.x;
      const dy = pt.y - pos.y;
      if (Math.hypot(dx, dy) <= HANDLE_HIT) return key;
    }
    return null;
  }

  // ===== Manifest / blanks =====
  async function ensureManifest() {
    if (MANIFEST) return MANIFEST;
    const res = await fetch('./assets/shirt_blanks/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    MANIFEST = await res.json();
    return MANIFEST;
  }

  async function setBlankFromFile(filename) {
    if (!filename) {
      state.blank = null; PPI_STAGE = null; BOX_PX = null;
      return scheduleDraw();
    }

    const items = await ensureManifest();
    const meta = items.find(m => m.file === filename) || null;

    const img = new Image();
    img.onload = () => {
      state.blank = img;

      const bw = img.width, bh = img.height;
      const sBlank = Math.min(STAGE.w / bw, STAGE.h / bh);

      if (meta?.ref?.px && meta?.ref?.in) {
        PPI_STAGE = (meta.ref.px * sBlank) / meta.ref.in;
      } else {
        PPI_STAGE = null;
      }

      if (PPI_STAGE && meta?.box_in) {
        const b = meta.box_in;
        const wOut = bw * sBlank, hOut = bh * sBlank;
        const xOut = (STAGE.w - wOut) / 2;
        const yOut = (STAGE.h - hOut) / 2;
        BOX_PX = {
          x: xOut + b.x * PPI_STAGE,
          y: yOut + b.y * PPI_STAGE,
          w: b.w * PPI_STAGE,
          h: b.h * PPI_STAGE
        };
      } else {
        BOX_PX = null;
      }

      scheduleDraw();
    };
    img.onerror = () => console.error('Failed to load blank image', filename);
    img.src = `./assets/shirt_blanks/${filename}`;
  }

  // side-aware setter; fall back to front if back missing
  async function setBlankForSide(baseFrontFile, side) {
    if (!baseFrontFile) return setBlankFromFile('');

    const base = baseFrontFile.replace(/_(front|back)(?=\.[^.]+$)/i, '_front');
    const target = base.replace(/_front(?=\.[^.]+$)/i, side === 'back' ? '_back' : '_front');

    const manifest = await ensureManifest();
    return setBlankFromFile(manifest.some(m => m.file === target) ? target : base);
  }

  function labelFromFilename(name) {
    const base = name.replace(/\.[^.]+$/, '');
    return base.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  async function loadShirtManifest() {
    try {
      const items = await ensureManifest();
      if (!blankSelect) return;

      const fronts = items.filter(m => /_front\.png$/i.test(m.file));

      blankSelect.innerHTML = '';
      for (const it of fronts) {
        const opt = document.createElement('option');
        opt.value = it.sku || it.file; // SKU drives pricing
        opt.dataset.file = it.file;    // filename drives preview art
        opt.textContent = it.label || labelFromFilename(it.file);
        blankSelect.appendChild(opt);
      }

      const initialOpt = blankSelect.options[0];

      if (initialOpt) {
        blankSelect.value = initialOpt.value;
        window.orderState.blankSku = initialOpt.value;
        window.orderState.blankBase = initialOpt.dataset.file || '';
        await setBlankForSide(window.orderState.blankBase, window.orderState.activeSide);
      } else {
        await setBlankFromFile('');
      }
    } catch (err) {
      console.error('Failed to load shirt manifest:', err);
      if (blankSelect) blankSelect.innerHTML = '<option value="">(No blanks found)</option>';
      state.blank = null; PPI_STAGE = null; BOX_PX = null;
      scheduleDraw();
    }
  }

  async function startCheckout({ email = '', fileId = '', orderNote = '' } = {}) {
    const res = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fileId, orderNote })
    });
    if (!res.ok) throw new Error('Checkout create failed');
    const { url } = await res.json();
    window.location.href = url;
  }

  // ===== Side toggle =====
  function setActiveSide(side) {
    if (!sideFrontBtn || !sideBackBtn) return;
    const prev = window.orderState.activeSide || 'front';

    // save previous side’s art state
    snapshotSide(prev);

    // update UI selection
    const isFront = side === 'front';
    sideFrontBtn.setAttribute('aria-selected', String(isFront));
    sideBackBtn.setAttribute('aria-selected', String(!isFront));

    // switch logical side
    window.orderState.activeSide = isFront ? 'front' : 'back';

    // swap the blank image to match the side
    if (window.orderState.blankBase) {
      setBlankForSide(window.orderState.blankBase, window.orderState.activeSide);
    }

    // restore that side’s art state (or clear if none yet)
    restoreSide(window.orderState.activeSide);

    // event (if anything else listens)
    document.dispatchEvent(new CustomEvent('qt:side-changed', {
      detail: { side: window.orderState.activeSide }
    }));
  }


  sideFrontBtn?.addEventListener('click', () => setActiveSide('front'));
  sideBackBtn?.addEventListener('click', () => setActiveSide('back'));

  // ===== Events =====
  if (artBtn && artInput) artBtn.addEventListener('click', () => artInput.click());

  function setArtName(msg) {
    if (!artNameEl) return;
    artNameEl.textContent = msg;
    refitFitline(artNameEl);
  }

  if (artInput) {
    artInput.addEventListener('change', async () => {
      const f = artInput.files && artInput.files[0];
      if (!f) {
        setArtName('(No file selected)');
        return;
      }

      // local preview
      setArtName(f.name);
      state.artImg = await loadImageFromFile(f);
      placeArtTopMaxWidth();
      crop = fullCropRect();
      cropMode = false;
      updateCropButtons();
      const keepBg = BG.enabled;
      BG_SELECTED = pickAutoBgTarget(state.artImg);
      processedArt = null;
      BG.enabled = keepBg && !!BG_SELECTED;
      updateBgButton();
      if (BG.enabled) rebuildProcessedArt();
      else scheduleDraw();
      snapshotSide(window.orderState.activeSide || 'front');

      // upload to Drive
      try {
        if (artBtn) artBtn.disabled = true;
        setArtName(`Uploading: ${f.name}…`);

        const meta = {
          customer_email: document.querySelector('#qtEmail')?.value || '',
          order_note: document.querySelector('#qtNotes')?.value || ''
        };

        const form = new FormData();
        form.append('file', f, f.name);
        form.append('customer_email', meta.customer_email);
        form.append('order_note', meta.order_note);

        const res = await fetch('/.netlify/functions/upload-to-drive', { method: 'POST', body: form });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`Upload failed HTTP ${res.status}${txt ? ` — ${txt}` : ''}`);
        }
        const result = await res.json();

        const fileId = result.id || result.fileId;
        const side = window.orderState.activeSide || 'front';
        const slot = ensureSide(side);
        const label = (f.name || '').replace(/\.[^.]+$/, '');
        window.orderState.fileId = fileId; // legacy global
        slot.fileId = fileId;
        slot.designLabel = label;
        slot.readoutIn = window.orderState.readoutIn || slot.readoutIn;
        slot.tierIn = window.orderState.currentTier?.tierIn ?? slot.tierIn ?? null;
        slot.currentTier = window.orderState.currentTier || slot.currentTier || null;
        window.orderState.orderNote = meta.order_note || '';
        window.orderState.pendingEmail = document.querySelector('#qtEmail')?.value || '';

        setArtName(`${f.name} ✓ uploaded`);
      } catch (err) {
        console.error(err);
        setArtName(`Upload failed: ${err.message}`);
        window.orderState.fileId = null;
        window.orderState.orderNote = '';
      } finally {
        if (artBtn) artBtn.disabled = false;
      }
    });
  }

  if (blankSelect) {
    blankSelect.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions?.[0];
      window.orderState.blankSku = opt?.value || '';
      window.orderState.blankBase = opt?.dataset.file || '';
      setBlankForSide(window.orderState.blankBase, window.orderState.activeSide);
    });
  }

  if (centerBtn) centerBtn.addEventListener('click', centerArt);
  if (fitBtn) fitBtn.addEventListener('click', fitArtToMaxArea);

  if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener('click', () => {
      if (!state.artImg) return;
      BG.enabled = !BG.enabled;
      if (BG.enabled && !BG_SELECTED) BG_SELECTED = pickAutoBgTarget(state.artImg);
      updateBgButton();
      updateBgScopeButton();
      rebuildProcessedArt();
    });
    updateBgButton();
  }
  if (bgScopeBtn) {
    bgScopeBtn.addEventListener('click', () => {
      BG.mode = (BG.mode === 'edge') ? 'global' : 'edge';
      updateBgScopeButton();
      if (BG.enabled) rebuildProcessedArt();
    });
    updateBgScopeButton();
  }

  if (cropToggleBtn) {
    cropToggleBtn.addEventListener('click', () => {
      if (!state.artImg) return;
      cropMode = !cropMode;
      updateCropButtons();
      scheduleDraw();
    });
  }
  if (cropResetBtn) {
    cropResetBtn.addEventListener('click', () => {
      if (!state.artImg) return;
      resetCrop();
      cropMode = true;
      updateCropButtons();
    });
  }

  // ===== Pointer interactions =====
  const pointers = new Map();
  let pinchStartDist = null;
  let pinchStartScale = 1;

  function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toStageXY(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 1 && state.artImg && cropMode) {
      const hit = hitCropHandle(p);
      if (hit) {
        const baseCrop = currentCrop() || fullCropRect();
        const anchorImg = (() => {
          const r = baseCrop;
          if (hit === 'nw') return { x: r.x + r.w, y: r.y + r.h };
          if (hit === 'ne') return { x: r.x, y: r.y + r.h };
          if (hit === 'sw') return { x: r.x + r.w, y: r.y };
          return { x: r.x, y: r.y }; // se
        })();
        const anchorStage = imgPointToStage(anchorImg.x, anchorImg.y, baseCrop, state.art.scale, state.art.tx, state.art.ty);
        cropDrag = {
          handle: hit,
          startPt: p,
          rect: baseCrop ? { ...baseCrop } : null,
          anchorImg,
          anchorStage
        };
        state.dragging = false;
        return;
      }
    }

    if (!cropMode && pointers.size === 1 && state.artImg && pointInArt(p.x, p.y)) {
      state.dragging = true;
      state.dragMode = (e.shiftKey ? 'scale' : 'move');
      state.last = p;
      scheduleDraw();
    }

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = dist(a, b);
      pinchStartScale = state.art.scale;
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = toStageXY(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 1 && cropDrag && state.artImg) {
      const rect0 = cropDrag.rect || fullCropRect();
      const dx = (p.x - cropDrag.startPt.x) / state.art.scale;
      const dy = (p.y - cropDrag.startPt.y) / state.art.scale;
      const imgW = state.artImg.width, imgH = state.artImg.height;

      let x = rect0.x, y = rect0.y, w = rect0.w, h = rect0.h;

      if (cropDrag.handle === 'nw') {
        const anchorX = rect0.x + rect0.w, anchorY = rect0.y + rect0.h;
        x = Math.max(0, Math.min(anchorX - CROP_MIN, rect0.x + dx));
        y = Math.max(0, Math.min(anchorY - CROP_MIN, rect0.y + dy));
        w = anchorX - x;
        h = anchorY - y;
      } else if (cropDrag.handle === 'ne') {
        const anchorX = rect0.x, anchorY = rect0.y + rect0.h;
        y = Math.max(0, Math.min(anchorY - CROP_MIN, rect0.y + dy));
        w = Math.max(CROP_MIN, Math.min(imgW - anchorX, rect0.w + dx));
        h = anchorY - y;
        x = anchorX;
      } else if (cropDrag.handle === 'sw') {
        const anchorX = rect0.x + rect0.w, anchorY = rect0.y;
        x = Math.max(0, Math.min(anchorX - CROP_MIN, rect0.x + dx));
        w = anchorX - x;
        h = Math.max(CROP_MIN, Math.min(imgH - anchorY, rect0.h + dy));
        y = anchorY;
      } else if (cropDrag.handle === 'se') {
        w = Math.max(CROP_MIN, Math.min(imgW - rect0.x, rect0.w + dx));
        h = Math.max(CROP_MIN, Math.min(imgH - rect0.y, rect0.h + dy));
        x = rect0.x; y = rect0.y;
      }

      // Clamp to image bounds/min
      crop = clampCropRect({ x, y, w, h });

      // Reposition art so the anchor point stays in the same stage position
      if (cropDrag.anchorImg && cropDrag.anchorStage) {
        const a = cropDrag.anchorStage;
        const r = crop;
        const scale = state.art.scale;
        state.art.tx = a.x - (cropDrag.anchorImg.x - r.x) * scale + (r.w * scale) / 2;
        state.art.ty = a.y - (cropDrag.anchorImg.y - r.y) * scale + (r.h * scale) / 2;
      }

      scheduleDraw();
    } else if (pointers.size === 1 && state.dragging) {
      if (state.dragMode === 'move') {
        state.art.tx += (p.x - state.last.x);
        state.art.ty += (p.y - state.last.y);
      } else {
        const d1 = Math.hypot(state.last.x - state.art.tx, state.last.y - state.art.ty);
        const d2 = Math.hypot(p.x - state.art.tx, p.y - state.art.ty);
        const s = d2 / Math.max(1, d1);
        state.art.scale *= s;
      }
      state.last = p;
      enforceConstraints();
      scheduleDraw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (pinchStartDist) {
        const factor = dist(a, b) / Math.max(1, pinchStartDist);
        state.art.scale = pinchStartScale * factor;
        enforceConstraints();
        scheduleDraw();
      }
    }
    e.preventDefault();
  }, { passive: false });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) {
      state.dragging = false;
      cropDrag = null;
      enforceConstraints();
      scheduleDraw();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerout', endPointer);

  // Prevent iOS page scroll while manipulating
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ===== Boot =====
  updateCropButtons();
  setActiveSide(window.orderState.activeSide); // sync button styles first
  setCanvasSize();
  loadShirtManifest();

  window.addEventListener('resize', setCanvasSize);
  window.addEventListener('orientationchange', setCanvasSize);
})();
