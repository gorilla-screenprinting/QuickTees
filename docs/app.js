
(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const blankSelect = document.getElementById('blankSelect');
  const artFile   = document.getElementById('artFile');
  const centerBtn = document.getElementById('centerBtn');
  const fitBtn    = document.getElementById('fitBtn');

  // Logical stage size
  const STAGE = { w: 1400, h: 1600 };

  // Max graphic area (used for sizing/fit only; not drawn)
  const MAX_IN   = { w: 14, h: 17 };
  const PPI_STAGE = 80;     // tweak later when you calibrate
  const SAFETY    = 40;     // margin to keep inside stage

  const DESIRED_W = Math.round(MAX_IN.w * PPI_STAGE);
  const DESIRED_H = Math.round(MAX_IN.h * PPI_STAGE);
  const PRINT = {
    w: Math.min(DESIRED_W, STAGE.w - SAFETY * 2),
    h: Math.min(DESIRED_H, STAGE.h - SAFETY * 2)
  };
  // center horizontally, sit slightly high for chest area
  PRINT.x = Math.round((STAGE.w - PRINT.w) / 2);
  PRINT.y = Math.max(SAFETY, Math.round((STAGE.h - PRINT.h) / 2 - STAGE.h * 0.06));

  // State
  const state = {
    blank: null,      // Image
    artImg: null,     // Image
    art: { tx: STAGE.w * 0.5, ty: STAGE.h * 0.45, scale: 0.5, rot: 0 },
    dragging: false,
    dragMode: 'move', // move | rotate | scale
    last: { x:0, y:0 },
    dpr: window.devicePixelRatio || 1
  };

  // ----- Utilities -----
  function setCanvasSize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const aspect = STAGE.w / STAGE.h;
    let targetW = cssW, targetH = cssW / aspect;
    if (targetH > cssH) { targetH = cssH; targetW = cssH * aspect; }

    canvas.width  = Math.round(targetW * state.dpr);
    canvas.height = Math.round(targetH * state.dpr);
    canvas.style.width  = `${Math.round(targetW)}px`;
    canvas.style.height = `${Math.round(targetH)}px`;

    draw();
  }

  async function loadShirtManifest() {
  try {
    const res = await fetch('./assets/shirt_blanks/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    // Populate dropdown
    blankSelect.innerHTML = '';
    items.forEach((it, idx) => {
      const opt = document.createElement('option');
      opt.value = it.file;
      opt.textContent = it.label || labelFromFilename(it.file);
      if (idx === 0) opt.selected = true;
      blankSelect.appendChild(opt);
    });

    // Auto-load first item
    if (items.length) {
      await setBlankFromFile(items[0].file);
    }
  } catch (err) {
    console.error('Failed to load shirt manifest:', err);
    // Fallback: show a single "None" option
    blankSelect.innerHTML = '<option value="">(No blanks found)</option>';
  }
}

async function setBlankFromFile(filename) {
  if (!filename) { state.blank = null; draw(); return; }
  const img = new Image();
  img.onload = () => { state.blank = img; draw(); };
  img.onerror = () => { console.error('Failed to load blank image', filename); };
  img.src = `./assets/shirt_blanks/${filename}`;
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

  // Map pointer/mouse event coords to stage coords
  function toStageXY(evt) {
    const r = canvas.getBoundingClientRect();
    const xCss = (evt.clientX - r.left);
    const yCss = (evt.clientY - r.top);
    const scale = (canvas.width / state.dpr) / STAGE.w;
    return { x: xCss / scale, y: yCss / scale };
  }

  function pointInArt(x, y) {
    if (!state.artImg) return false;
    const { tx, ty, rot, scale } = state.art;
    const dx = x - tx, dy = y - ty;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const hw = (state.artImg.width * scale)/2;
    const hh = (state.artImg.height * scale)/2;
    return (lx >= -hw && lx <= hw && ly >= -hh && ly <= hh);
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

  // ----- Draw -----
  function draw() {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const scale = (canvas.width / state.dpr) / STAGE.w;
    ctx.scale(scale * state.dpr, scale * state.dpr);

    // Draw blank (if any)
    if (state.blank) {
      const bw = state.blank.width, bh = state.blank.height;
      const s = Math.min(STAGE.w / bw, STAGE.h / bh);
      const w = bw * s, h = bh * s;
      const x = (STAGE.w - w)/2, y = (STAGE.h - h)/2;
      ctx.drawImage(state.blank, x, y, w, h);
    }
    // else: leave the CSS gradient background visible

    // Draw artwork
    if (state.artImg) {
      ctx.save();
      clampScale();
      ctx.translate(state.art.tx, state.art.ty);
      ctx.rotate(state.art.rot);
      const w = state.artImg.width * state.art.scale;
      const h = state.artImg.height * state.art.scale;
      ctx.drawImage(state.artImg, -w/2, -h/2, w, h);

      // Optional drag bbox (keep for UX)
      if (state.dragging) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)';
        ctx.setLineDash([8,6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(-w/2, -h/2, w, h);
      }
      ctx.restore();
    }
  }

  // ----- Actions -----
  function centerArt() {
    state.art.tx = STAGE.w * 0.5;
    state.art.ty = STAGE.h * 0.45;
    draw();
  }

  function fitArtToMaxArea() {
    if (!state.artImg) return;
    const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
    state.art.scale = cap * 0.96; // slight margin
    state.art.rot = 0;
    state.art.tx = PRINT.x + PRINT.w/2;
    state.art.ty = PRINT.y + PRINT.h/2;
    draw();
  }

  // ----- Events -----


  artFile.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    state.artImg = await loadImageFromFile(f);
    state.art.scale = Math.min(
      PRINT.w / state.artImg.width,
      PRINT.h / state.artImg.height
    ) * 0.8;
    centerArt();
  });

  centerBtn.addEventListener('click', centerArt);
  fitBtn.addEventListener('click', fitArtToMaxArea);

if (blankSelect) {
  blankSelect.addEventListener('change', async (e) => {
    const file = e.target.value || '';
    await setBlankFromFile(file);
  });
}

function labelFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '');
  return base.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}





  // Mouse interactions
  canvas.addEventListener('mousedown', (e) => {
    const m = toStageXY(e);
    if (state.artImg && pointInArt(m.x, m.y)) {
      state.dragging = true;
      state.dragMode = (e.metaKey || e.ctrlKey) ? 'rotate' : (e.shiftKey ? 'scale' : 'move');
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
    } else if (state.dragMode === 'rotate') {
      const a1 = Math.atan2(state.last.y - state.art.ty, state.last.x - state.art.tx);
      const a2 = Math.atan2(m.y - state.art.ty, m.x - state.art.tx);
      state.art.rot += (a2 - a1);
    } else if (state.dragMode === 'scale') {
      const d1 = Math.hypot(state.last.x - state.art.tx, state.last.y - state.art.ty);
      const d2 = Math.hypot(m.x - state.art.tx, m.y - state.art.ty);
      const s = d2 / Math.max(1, d1);
      state.art.scale *= s;
      clampScale();
    }

    state.last = m;
    draw();
  });

  window.addEventListener('mouseup', () => { state.dragging = false; });

  // ===== Mobile touch support (single-finger drag, pinch-to-zoom) =====
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
      state.dragMode = 'move'; // mobile: 1 finger = move
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
      const dx = p.x - state.last.x;
      const dy = p.y - state.last.y;
      state.art.tx += dx;
      state.art.ty += dy;
      state.last = p;
      draw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = dist(a, b);
      if (pinchStartDist) {
        const factor = d / Math.max(1, pinchStartDist);
        state.art.scale = pinchStartScale * factor;
        clampScale();
        draw();
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

  // extra safety for iOS
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });

  window.addEventListener('resize', setCanvasSize);
  window.addEventListener('orientationchange', setCanvasSize);

  // Boot
  setCanvasSize();
  loadShirtManifest();
})();
