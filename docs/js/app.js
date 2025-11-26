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

  const sideFrontBtn = document.getElementById('qtSideFront');
  const sideBackBtn = document.getElementById('qtSideBack');

  // ===== Public order state =====
  window.orderState = window.orderState || {};
  if (!window.orderState.activeSide) window.orderState.activeSide = 'front'; // default

  window.orderState.sides = window.orderState.sides || {};

  function defaultArtPose() {
    return { tx: 1400 * 0.5, ty: 1600 * 0.45, scale: 0.5 }; // uses your STAGE constants
  }

  function snapshotSide(side) {
    window.orderState.sides[side] = {
      artImg: state.artImg || null,
      processedArt: processedArt || null,
      art: { ...state.art },
      bgSel: BG_SELECTED || null
    };
  }

  function restoreSide(side) {
    const saved = window.orderState.sides[side];
    if (saved) {
      state.artImg = saved.artImg || null;
      processedArt = saved.processedArt || null;
      state.art = saved.art ? { ...saved.art } : defaultArtPose();
      BG_SELECTED = saved.bgSel || null;
    } else {
      state.artImg = null;
      processedArt = null;
      state.art = defaultArtPose();
      BG_SELECTED = null;
    }
    scheduleDraw();
  }

  // ===== Constants =====
  const STAGE = { w: 1400, h: 1600 };
  const MAX_IN = { w: 11.7, h: 16.5 };
  const PPI_HINT = 80;
  const SAFETY = 40;
  const FIT_PAD = 0;
  const CLAMP_EPS_PX = 0.5;

  const DESIRED_W = Math.round(MAX_IN.w * PPI_HINT);
  const DESIRED_H = Math.round(MAX_IN.h * PPI_HINT);

  const PRINT = {
    w: Math.min(DESIRED_W, STAGE.w - SAFETY * 2),
    h: Math.min(DESIRED_H, STAGE.h - SAFETY * 2)
  };
  PRINT.x = Math.round((STAGE.w - PRINT.w) / 2);
  PRINT.y = Math.max(SAFETY, Math.round((STAGE.h - PRINT.h) / 2 - STAGE.h * 0.06));

  // ===== BG removal state =====
  const bgSwatches = document.getElementById('bgSwatches');
  const bgModeSel = document.getElementById('bgMode');
  const bgTolInput = document.getElementById('bgTol');
  const bgFeatherIn = document.getElementById('bgFeather');

  const BG = { mode: 'none', tol: 40, feather: 1 };
  let BG_SELECTED = null;
  let processedArt = null;

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

  // ===== Helpers =====
  const area = () => (BOX_PX || PRINT);

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
    const hw = (state.artImg.width * state.art.scale) / 2;
    const hh = (state.artImg.height * state.art.scale) / 2;
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
    if (!state.artImg) return;
    const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
    const epsScale = CLAMP_EPS_PX / state.artImg.width;
    state.art.scale = Math.min(state.art.scale, cap - epsScale);

    const a = area();
    const halfW = (state.artImg.width * state.art.scale) / 2;
    const halfH = (state.artImg.height * state.art.scale) / 2;

    const minX = a.x + halfW, maxX = a.x + a.w - halfW;
    const minY = a.y + halfH, maxY = a.y + a.h - halfH;

    state.art.tx = Math.min(Math.max(state.art.tx, minX), maxX);
    state.art.ty = Math.min(Math.max(state.art.ty, minY), maxY);
  }

  function getArtSizeInches() {
    if (!state.artImg || !PPI_STAGE) return null;
    const w_px = state.artImg.width * state.art.scale;
    const h_px = state.artImg.height * state.art.scale;
    return { w_in: w_px / PPI_STAGE, h_in: h_px / PPI_STAGE };
  }

  function updateReadout() {
    if (!sizeReadout) return;
    const s = getArtSizeInches();
    window.orderState.readoutIn = s || null;

    sizeReadout.textContent = s ? `${s.w_in.toFixed(2)}" W × ${s.h_in.toFixed(2)}" H` : '—';

    if (s && typeof window.deriveDtfTier === 'function') {
      window.orderState.currentTier = window.deriveDtfTier(s); // { tierIn, key, tooLarge }
    }

    const placeBtn = document.getElementById('qtPlaceBtn');
    if (window.orderState?.currentTier?.tooLarge) {
      sizeReadout.textContent = `Too large for DTF — max 16"`;
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
      enforceConstraints();
      const src = processedArt || state.artImg;
      const w = src.width * state.art.scale;
      const h = src.height * state.art.scale;

      ctx.save();
      ctx.translate(state.art.tx, state.art.ty);
      ctx.drawImage(src, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  // ===== Actions =====
  function placeArtTopMaxWidth() {
    if (!state.artImg) return;
    const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
    const epsScale = CLAMP_EPS_PX / state.artImg.width;
    state.art.scale = cap - epsScale;

    const a = area();
    const scaledH = state.artImg.height * state.art.scale;
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

  function renderSwatches(groups) {
    if (!bgSwatches) return;
    bgSwatches.innerHTML = '';
    BG_SELECTED = null;

    groups.forEach((g, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.title = `Corner color ${idx + 1}`;
      btn.style.background = `rgb(${g.rgb[0]},${g.rgb[1]},${g.rgb[2]})`;
      btn.addEventListener('click', () => {
        [...bgSwatches.children].forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        BG_SELECTED = g;
        rebuildProcessedArt();
      });
      bgSwatches.appendChild(btn);
    });
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

  async function rebuildProcessedArt() {
    processedArt = null;
    if (!state.artImg || BG.mode === 'none') { scheduleDraw(); return; }
    if (!BG_SELECTED) { scheduleDraw(); return; }

    const src = state.artImg;
    const w = src.width, h = src.height;

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(src, 0, 0);

    const imgData = cx.getImageData(0, 0, w, h);
    const mask = new Uint8ClampedArray(w * h);

    if (BG.mode === 'threshold') {
      makeMaskThresholdTarget(imgData.data, w, h, BG.tol, mask, BG_SELECTED.rgb);
    } else {
      makeMaskWandSeeds(imgData.data, w, h, BG.tol, mask, BG_SELECTED);
    }

    erodeMask(mask, w, h, 1);
    if (BG.feather > 0) blurMask(mask, w, h, BG.feather);

    applyMaskToImage(imgData.data, mask);
    cx.putImageData(imgData, 0, 0);
    processedArt = c;

    scheduleDraw();
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

  if (artInput) {
    artInput.addEventListener('change', async () => {
      const f = artInput.files && artInput.files[0];
      if (!f) {
        if (artNameEl) artNameEl.textContent = '(No file selected)';
        return;
      }

      // local preview
      if (artNameEl) artNameEl.textContent = f.name;
      state.artImg = await loadImageFromFile(f);
      placeArtTopMaxWidth();
      const sampled = sampleCornerColors(state.artImg);
      const groups = dedupeColors(sampled, 12);
      renderSwatches(groups);
      rebuildProcessedArt();
      snapshotSide(window.orderState.activeSide || 'front');

      // upload to Drive
      try {
        if (artBtn) artBtn.disabled = true;
        if (artNameEl) artNameEl.textContent = `Uploading: ${f.name}…`;

        const meta = {
          customer_email: document.querySelector('#qtEmail')?.value || '',
          order_note: document.querySelector('#qtNotes')?.value || ''
        };

        const form = new FormData();
        form.append('file', f, f.name);
        form.append('customer_email', meta.customer_email);
        form.append('order_note', meta.order_note);

        const res = await fetch('/.netlify/functions/upload-to-drive', { method: 'POST', body: form });
        if (!res.ok) throw new Error(`Upload failed HTTP ${res.status}`);
        const result = await res.json();

        const fileId = result.id || result.fileId;
        window.orderState.fileId = fileId;
        window.orderState.orderNote = meta.order_note || '';
        window.orderState.pendingEmail = document.querySelector('#qtEmail')?.value || '';

        if (artNameEl) {
          const safe = f.name.replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
          artNameEl.innerHTML = `${safe} ✓ uploaded — <a href="${result.webViewLink}" target="_blank" rel="noopener">Open in Drive</a>`;
        }
      } catch (err) {
        console.error(err);
        if (artNameEl) artNameEl.textContent = `Upload failed: ${err.message}`;
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

  if (bgModeSel) {
    bgModeSel.addEventListener('change', () => {
      BG.mode = bgModeSel.value;
      rebuildProcessedArt();
    });
  }
  if (bgTolInput) {
    bgTolInput.addEventListener('input', () => {
      BG.tol = parseInt(bgTolInput.value, 10) || 40;
      rebuildProcessedArt();
    });
  }
  if (bgFeatherIn) {
    bgFeatherIn.addEventListener('input', () => {
      BG.feather = parseInt(bgFeatherIn.value, 10) || 0;
      rebuildProcessedArt();
    });
  }

  const qtPlaceBtn = document.getElementById('qtPlaceBtn');
  if (qtPlaceBtn) {
    qtPlaceBtn.addEventListener('click', () => {
      const email = (document.querySelector('#qtEmail')?.value || window.orderState.pendingEmail || '').trim();
      const fileId = window.orderState.fileId || '';
      const orderNote = window.orderState.orderNote || '';
      if (!fileId) { alert('Upload your art first, then try again.'); return; }
      startCheckout({ email, fileId, orderNote });
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

    if (pointers.size === 1 && state.artImg && pointInArt(p.x, p.y)) {
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

    if (pointers.size === 1 && state.dragging) {
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
  setActiveSide(window.orderState.activeSide); // sync button styles first
  setCanvasSize();
  loadShirtManifest();

  window.addEventListener('resize', setCanvasSize);
  window.addEventListener('orientationchange', setCanvasSize);
})();
