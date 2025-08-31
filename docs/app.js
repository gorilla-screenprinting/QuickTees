(() => {
  // ---- Elements ----
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const blankSelect = document.getElementById('blankSelect');
  const artInput    = document.getElementById('artFile');
  const artBtn      = document.getElementById('artFileBtn');
  const artNameEl   = document.getElementById('artFileName');

  const centerBtn = document.getElementById('centerBtn');
  const fitBtn    = document.getElementById('fitBtn');

  // Optional live readout element (add in HTML if you want)
  const sizeReadout = document.getElementById('sizeReadout');

  // ---- Constants (fallback PRINT area if no per-blank box is provided) ----
  const STAGE   = { w: 1400, h: 1600 };
  const MAX_IN  = { w: 14, h: 17 };       // fallback max printable in inches
  const PPI_HNT = 80;                      // fallback pixels-per-inch hint
  const SAFETY  = 40;
  const FIT_PAD   = 0;        // 0 = no padding; set to e.g. 0.02 for 2% breathing room
  const CLAMP_EPS_PX = 0.5;     // tiny epsilon to avoid float jitter


  const DESIRED_W = Math.round(MAX_IN.w * PPI_HNT);
  const DESIRED_H = Math.round(MAX_IN.h * PPI_HNT);

  const PRINT = {
    w: Math.min(DESIRED_W, STAGE.w - SAFETY * 2),
    h: Math.min(DESIRED_H, STAGE.h - SAFETY * 2)
  };
  PRINT.x = Math.round((STAGE.w - PRINT.w) / 2);
  PRINT.y = Math.max(SAFETY, Math.round((STAGE.h - PRINT.h) / 2 - STAGE.h * 0.06));

  // ---- State ----
  const state = {
    blank: null,                 // Image of shirt
    artImg: null,                // Uploaded art
    art: { tx: STAGE.w * 0.5, ty: STAGE.h * 0.45, scale: 0.5 },
    dragging: false,
    dragMode: 'move',            // 'move' | 'scale'
    last: { x: 0, y: 0 },
    dpr: Math.min(window.devicePixelRatio || 1, 1.75)
  };

  // Per-blank calibration/placement
  let MANIFEST = null;           // cache of manifest array
  let BLANK_META = null;         // manifest entry for current blank
  let PPI_STAGE = null;          // stage pixels per inch for current blank (computed)
  let BOX_PX = null;             // placement rect (in STAGE px) for current blank

  // ---- rAF scheduler ----
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

  // Axis-aligned hit test
  function pointInArt(x, y) {
    if (!state.artImg) return false;
    const hw = (state.artImg.width  * state.art.scale) / 2;
    const hh = (state.artImg.height * state.art.scale) / 2;
    return (x >= state.art.tx - hw && x <= state.art.tx + hw &&
            y >= state.art.ty - hh && y <= state.art.ty + hh);
  }

function maxScaleForPrintArea(imgW, imgH) {
  const area = BOX_PX || PRINT;
  const sx = area.w / imgW;
  const sy = area.h / imgH;
  const cap = Math.min(sx, sy);
  return cap * (1 - FIT_PAD); // exact when FIT_PAD = 0
}

function clampScale() {
  if (!state.artImg) return;
  const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
  // subtract a tiny amount in *scale* equivalent to ~0.5 output px
  const epsScale = CLAMP_EPS_PX / state.artImg.width;
  state.art.scale = Math.min(state.art.scale, cap - epsScale);
}



  function clampArtPosition() {
    if (!state.artImg) return;
    const area = BOX_PX || { x: 0, y: 0, w: STAGE.w, h: STAGE.h };
    const halfW = (state.artImg.width  * state.art.scale) / 2;
    const halfH = (state.artImg.height * state.art.scale) / 2;

    const minX = area.x + halfW;
    const maxX = area.x + area.w - halfW;
    const minY = area.y + halfH;
    const maxY = area.y + area.h - halfH;

    state.art.tx = Math.min(Math.max(state.art.tx, minX), maxX);
    state.art.ty = Math.min(Math.max(state.art.ty, minY), maxY);
  }

  function getArtSizeInches() {
    if (!state.artImg || !PPI_STAGE) return null;
    const w_px = state.artImg.width  * state.art.scale;
    const h_px = state.artImg.height * state.art.scale;
    return { w_in: w_px / PPI_STAGE, h_in: h_px / PPI_STAGE };
  }

  function updateReadout() {
    if (!sizeReadout) return;
    const s = getArtSizeInches();
    sizeReadout.textContent = s ? `${s.w_in.toFixed(2)}" W × ${s.h_in.toFixed(2)}" H` : '—';
  }

  // ---- Drawing ----
  // 1) draw(): shirt → (guide if dragging) → art (no art bbox)
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = (canvas.width / state.dpr) / STAGE.w;
  ctx.scale(scale * state.dpr, scale * state.dpr);

  // Shirt
  if (state.blank) {
    const bw = state.blank.width, bh = state.blank.height;
    const s = Math.min(STAGE.w / bw, STAGE.h / bh);
    const w = bw * s, h = bh * s;
    const x = (STAGE.w - w) / 2, y = (STAGE.h - h) / 2;
    ctx.drawImage(state.blank, x, y, w, h);
  }

  // Placement guide only while dragging
  if (state.dragging) drawPrintGuide();

  // Artwork
  if (state.artImg) {

    const w = state.artImg.width  * state.art.scale;
    const h = state.artImg.height * state.art.scale;

    ctx.save();
    ctx.translate(state.art.tx, state.art.ty);
    ctx.drawImage(state.artImg, -w/2, -h/2, w, h);
    ctx.restore();
  }
}



  // ---- Actions ----
function placeArtTopMaxWidth() {
  if (!state.artImg) return;
  const area = BOX_PX || PRINT;

  const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
  const epsScale = CLAMP_EPS_PX / state.artImg.width;
  state.art.scale = cap - epsScale;

  const scaledH = state.artImg.height * state.art.scale;
  state.art.tx = area.x + area.w / 2;   // center horizontally
  state.art.ty = area.y + scaledH / 2;  // top-align in the box

  clampArtPosition();
  scheduleDraw();
}



// 2) drawPrintGuide(): single medium-gray dashed rectangle over BOX_PX or PRINT
function drawPrintGuide() {
  const area = BOX_PX || PRINT;
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(140,140,140,0.95)'; // medium gray that shows on white & black
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  ctx.restore();
}


  function centerArt() {
    // center inside placement area if present
    if (BOX_PX) {
      state.art.tx = BOX_PX.x + BOX_PX.w / 2;
      state.art.ty = BOX_PX.y + BOX_PX.h / 2;
    } else {
      state.art.tx = STAGE.w * 0.5;
      state.art.ty = STAGE.h * 0.45;
    }
    clampArtPosition();
    scheduleDraw();
  }

function fitArtToMaxArea() { placeArtTopMaxWidth(); }


  // ---- Manifest / blanks ----
  async function ensureManifest() {
    if (MANIFEST) return MANIFEST;
    const res = await fetch('./assets/shirt_blanks/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    MANIFEST = await res.json();
    return MANIFEST;
  }

  async function loadShirtManifest() {
    try {
      const items = await ensureManifest();
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
      PPI_STAGE = null;
      BOX_PX = null;
      scheduleDraw();
    }
  }

  async function setBlankFromFile(filename) {
    if (!filename) {
      state.blank = null;
      BLANK_META = null;
      PPI_STAGE = null;
      BOX_PX = null;
      scheduleDraw();
      return;
    }

    const items = await ensureManifest();
    BLANK_META = items.find(m => m.file === filename) || null;

    const img = new Image();
    img.onload = () => {
      state.blank = img;

      // Compute how much the shirt image is scaled to fit the stage
      const bw = img.width, bh = img.height;
      const sBlank = Math.min(STAGE.w / bw, STAGE.h / bh);

      // stage pixels-per-inch (from meta ref)
      if (BLANK_META?.ref?.px && BLANK_META?.ref?.in) {
        PPI_STAGE = (BLANK_META.ref.px * sBlank) / BLANK_META.ref.in;
      } else {
        PPI_STAGE = null;
      }

      // Build placement box in stage px (from inches)
      if (PPI_STAGE && BLANK_META?.box_in) {
        const b = BLANK_META.box_in;
        const wDraw = bw * sBlank, hDraw = bh * sBlank;
        const xDraw = (STAGE.w - wDraw) / 2;
        const yDraw = (STAGE.h - hDraw) / 2;

        BOX_PX = {
          x: xDraw + b.x * PPI_STAGE,
          y: yDraw + b.y * PPI_STAGE,
          w: b.w * PPI_STAGE,
          h: b.h * PPI_STAGE
        };
      } else {
        BOX_PX = null;
      }
    
      scheduleDraw();
    };
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

      placeArtTopMaxWidth();
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
      state.dragMode = (e.shiftKey ? 'scale' : 'move'); // Shift = scale
      state.last = m;
    }
  });

  canvas.addEventListener('mouseleave', () => {
  if (state.dragging) {
    state.dragging = false;
    scheduleDraw();
  }
});



  window.addEventListener('mousemove', (e) => {
    if (!state.dragging) return;
    const m  = toStageXY(e);
    const dx = m.x - state.last.x;
    const dy = m.y - state.last.y;

    if (state.dragMode === 'move') {
      state.art.tx += dx;
      state.art.ty += dy;
      clampArtPosition();
    } else { // 'scale'
      const d1 = Math.hypot(state.last.x - state.art.tx, state.last.y - state.art.ty);
      const d2 = Math.hypot(m.x - state.art.tx, m.y - state.art.ty);
      const s  = d2 / Math.max(1, d1);
      state.art.scale *= s;
      clampScale();
      clampArtPosition();
    }
    state.last = m;
    scheduleDraw();
  });

  window.addEventListener('mouseup', () => {
  state.dragging = false;
  scheduleDraw();     // <= force a clean frame with no guide
});

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
      state.dragMode = e.shiftKey ? 'scale' : 'move';
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
        clampArtPosition();
      } else {
        const d1 = Math.hypot(state.last.x - state.art.tx, state.last.y - state.art.ty);
        const d2 = Math.hypot(p.x - state.art.tx, p.y - state.art.ty);
        const s  = d2 / Math.max(1, d1);
        state.art.scale *= s;
        clampScale();
        clampArtPosition();
      }
      state.last = p;
      scheduleDraw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (pinchStartDist) {
        const factor = dist(a, b) / Math.max(1, pinchStartDist);
        state.art.scale = pinchStartScale * factor;
        clampScale();
        clampArtPosition();
        scheduleDraw();
      }
    }
    e.preventDefault();
  }, { passive: false });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) state.dragging = false;
    scheduleDraw(); 
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
