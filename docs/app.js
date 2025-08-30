(() => {
  // ---- Elements ----
  const canvas     = document.getElementById('stage');
  const ctx        = canvas.getContext('2d', { willReadFrequently: true });

  const blankSelect = document.getElementById('blankSelect');
  const artInput    = document.getElementById('artFile');
  const artBtn      = document.getElementById('artFileBtn');
  const artNameEl   = document.getElementById('artFileName');

  const centerBtn  = document.getElementById('centerBtn');
  const fitBtn     = document.getElementById('fitBtn');

  // ---- Constants ----
  const STAGE      = { w: 1400, h: 1600 };
  const MAX_IN     = { w: 14, h: 17 };
  const PPI_STAGE  = 80;   // adjust after calibration
  const SAFETY     = 40;

  const DESIRED_W  = Math.round(MAX_IN.w * PPI_STAGE);
  const DESIRED_H  = Math.round(MAX_IN.h * PPI_STAGE);

  const PRINT = {
    w: Math.min(DESIRED_W, STAGE.w - SAFETY * 2),
    h: Math.min(DESIRED_H, STAGE.h - SAFETY * 2)
  };
  PRINT.x = Math.round((STAGE.w - PRINT.w) / 2);
  PRINT.y = Math.max(SAFETY, Math.round((STAGE.h - PRINT.h) / 2 - STAGE.h * 0.06));

  // ---- State ----
  const state = {
    blank: null,                         // Image
    artImg: null,                        // Image
    art: { tx: STAGE.w * 0.5, ty: STAGE.h * 0.45, scale: 0.5 },
    dragging: false,
    dragMode: 'move',                    // 'move' | 'scale'
    last: { x: 0, y: 0 },
    dpr: Math.min(window.devicePixelRatio || 1, 1.75) // cap DPR for perf
  };

  // ---- rAF scheduler ----
  let needsDraw = false;
  function scheduleDraw() {
    if (needsDraw) return;
    needsDraw = true;
    requestAnimationFrame(() => {
      needsDraw = false;
      draw();
    });
  }

  // ---- Utilities ----
  function setCanvasSize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const aspect = STAGE.w / STAGE.h;

    let targetW = cssW;
    let targetH = cssW / aspect;
    if (targetH > cssH) { targetH = cssH; targetW = cssH * aspect; }

    canvas.width  = Math.round(targetW * state.dpr);
    canvas.height = Math.round(targetH * state.dpr);
    canvas.style.width  = `${Math.round(targetW)}px`;
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
    const xCss = (evt.clientX - r.left);
    const yCss = (evt.clientY - r.top);
    const scale = (canvas.width / state.dpr) / STAGE.w;
    return { x: xCss / scale, y: yCss / scale };
  }

  // Axis-aligned hit test (no rotation anywhere)
  function pointInArt(x, y) {
    if (!state.artImg) return false;
    const hw = (state.artImg.width  * state.art.scale) / 2;
    const hh = (state.artImg.height * state.art.scale) / 2;
    return (x >= state.art.tx - hw && x <= state.art.tx + hw &&
            y >= state.art.ty - hh && y <= state.art.ty + hh);
  }

  function maxScaleForPrintArea(imgW, imgH) {
    const sx = PRINT.w / imgW;
    const sy = PRINT.h / imgH;
    return Math.min(sx, sy);
  }

  function clampScale() {
    if (!state.artImg) return;
    const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
    state.art.scale = Math.min(state.art.scale, cap);
  }

  // ---- Drawing ----
  function draw() {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = (canvas.width / state.dpr) / STAGE.w;
    ctx.scale(scale * state.dpr, scale * state.dpr);

    // Blank (shirt)
    if (state.blank) {
      const bw = state.blank.width, bh = state.blank.height;
      const s = Math.min(STAGE.w / bw, STAGE.h / bh);
      const w = bw * s, h = bh * s;
      const x = (STAGE.w - w) / 2, y = (STAGE.h - h) / 2;
      ctx.drawImage(state.blank, x, y, w, h);
    }

    // Artwork
    if (state.artImg) {
      ctx.save();
      clampScale();
      ctx.translate(state.art.tx, state.art.ty);
      const w = state.artImg.width * state.art.scale;
      const h = state.artImg.height * state.art.scale;
      ctx.drawImage(state.artImg, -w/2, -h/2, w, h);

      // Optional drag box
      if (state.dragging) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.setLineDash([8,6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(-w/2, -h/2, w, h);
      }
      ctx.restore();
    }
  }

  // ---- Actions ----
  function centerArt() {
    state.art.tx = STAGE.w * 0.5;
    state.art.ty = STAGE.h * 0.45;
    scheduleDraw();
  }

  function fitArtToMaxArea() {
    if (!state.artImg) return;
    const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
    state.art.scale = cap * 0.96; // breathing room
    state.art.tx = PRINT.x + PRINT.w / 2;
    state.art.ty = PRINT.y + PRINT.h / 2;
    scheduleDraw();
  }

  // ---- Shirt blanks (manifest) ----
  async function loadShirtManifest() {
    try {
      const res = await fetch('./assets/shirt_blanks/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = await res.json();

      if (!blankSelect) return;

      blankSelect.innerHTML = '';
      items.forEach((it, idx) => {
        const opt = document.createElement('option');
        opt.value = it.file;
        opt.textContent = it.label || labelFromFilename(it.file);
        if (idx === 0) opt.selected = true;
        blankSelect.appendChild(opt);
      });

      if (items.length) await setBlankFromFile(items[0].file);
    } catch (err) {
      console.error('Failed to load shirt manifest:', err);
      if (blankSelect) blankSelect.innerHTML = '<option value="">(No blanks found)</option>';
      state.blank = null;
      scheduleDraw();
    }
  }

  async function setBlankFromFile(filename) {
    if (!filename) { state.blank = null; scheduleDraw(); return; }
    const img = new Image();
    img.onload = () => { state.blank = img; scheduleDraw(); };
    img.onerror = () => { console.error('Failed to load blank image', filename); };
    img.src = `./assets/shirt_blanks/${filename}`;
  }

  function labelFromFilename(name) {
    const base = name.replace(/\.[^.]+$/, '');
    return base.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ---- Event wiring ----

  // Art upload (hidden input triggered by button)
  if (artBtn && artInput) {
    artBtn.addEventListener('click', () => artInput.click());
  }
  if (artInput) {
    artInput.addEventListener('change', async () => {
      const f = artInput.files && artInput.files[0];
      if (!f) { if (artNameEl) artNameEl.textContent = '(No file selected)'; return; }
      if (artNameEl) artNameEl.textContent = f.name;
      state.artImg = await loadImageFromFile(f);
      state.art.scale = Math.min(
        PRINT.w / state.artImg.width,
        PRINT.h / state.artImg.height
      ) * 0.8;
      centerArt(); // schedules draw
    });
  }

  // Shirt select
  if (blankSelect) {
    blankSelect.addEventListener('change', (e) => {
      const file = e.target.value || '';
      setBlankFromFile(file);
    });
  }

  // Buttons
  if (centerBtn) centerBtn.addEventListener('click', centerArt);
  if (fitBtn)    fitBtn.addEventListener('click', fitArtToMaxArea);

  // Mouse (desktop)
  canvas.addEventListener('mousedown', (e) => {
    const m = toStageXY(e);
    if (state.artImg && pointInArt(m.x, m.y)) {
      state.dragging = true;
      state.dragMode = (e.shiftKey ? 'scale' : 'move'); // desktop: Shift = scale
      state.last = m;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const m = toStageXY(e);
    const dx = m.x - state.last.x;
    const dy = m.y - state.last.y;

    if (state.dragMode === 'move') {
      state.art.tx += dx;
      state.art.ty += dy;
    } else { // 'scale'
      const d1 = Math.hypot(state.last.x - state.art.tx, state.last.y - state.art.ty);
      const d2 = Math.hypot(m.x - state.art.tx, m.y - state.art.ty);
      const s  = d2 / Math.max(1, d1);
      state.art.scale *= s;
      clampScale();
    }
    state.last = m;
    scheduleDraw();
  });

  window.addEventListener('mouseup', () => { state.dragging = false; });

  // Touch / pen (pointer events)
  const pointers = new Map();
  let pinchStartDist = null;
  let pinchStartScale = 1;

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toStageXY(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 1 && state.artImg && pointInArt(p.x, p.y)) {
      state.dragging = true;
      state.dragMode = e.shiftKey ? 'scale' : 'move'; // pens + keyboards
      state.last = p;
    }

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = dist(a, b);
      pinchStartScale = state.art.scale;
    }
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = toStageXY(e);
    pointers.set(e.pointerId, p);

    if (pointers.size === 1 && state.dragging) {
      if (state.dragMode === 'move') {
        const dx = p.x - state.last.x;
        const dy = p.y - state.last.y;
        state.art.tx += dx;
        state.art.ty += dy;
      } else {
        const d1 = Math.hypot(state.last.x - state.art.tx, state.last.y - state.art.ty);
        const d2 = Math.hypot(p.x - state.art.tx, p.y - state.art.ty);
        const s  = d2 / Math.max(1, d1);
        state.art.scale *= s;
        clampScale();
      }
      state.last = p;
      scheduleDraw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (pinchStartDist) {
        const factor = dist(a, b) / Math.max(1, pinchStartDist);
        state.art.scale = pinchStartScale * factor;
        clampScale();
        scheduleDraw();
      }
    }
    e.preventDefault();
  }, { passive: false });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) state.dragging = false;
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // iOS belt-and-suspenders
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });

  // Resize
  window.addEventListener('resize', setCanvasSize);
  window.addEventListener('orientationchange', setCanvasSize);

  // ---- Boot ----
  setCanvasSize();
  loadShirtManifest();
})();
