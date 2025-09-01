(() => {
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

  // ===== Constants (fallbacks if a blank has no box_in/ref) =====
  const STAGE = { w: 1400, h: 1600 };
  const MAX_IN = { w: 11.7, h: 16.5 };
  const PPI_HINT = 80;              // pixels-per-inch hint for fallback
  const SAFETY = 40;
  const FIT_PAD = 0;               // e.g. 0.02 for 2% breathing room
  const CLAMP_EPS_PX = 0.5;         // ~½ px slack to avoid float jitter

  const DESIRED_W = Math.round(MAX_IN.w * PPI_HINT);
  const DESIRED_H = Math.round(MAX_IN.h * PPI_HINT);

  const PRINT = {
    w: Math.min(DESIRED_W, STAGE.w - SAFETY * 2),
    h: Math.min(DESIRED_H, STAGE.h - SAFETY * 2)
  };
  PRINT.x = Math.round((STAGE.w - PRINT.w) / 2);
  PRINT.y = Math.max(SAFETY, Math.round((STAGE.h - PRINT.h) / 2 - STAGE.h * 0.06));

  // BG removal UI
  const bgSwatches = document.getElementById('bgSwatches');
  const bgModeSel = document.getElementById('bgMode');
  const bgTolInput = document.getElementById('bgTol');
  const bgFeatherIn = document.getElementById('bgFeather');

  // BG state (defaults to OFF)
  const BG = {
    mode: 'none',   // 'none' | 'wand' | 'threshold'
    tol: 40,        // 5..90
    feather: 1      // 0..3 px (source-size pixels)
  };

  // currently selected swatch group (or null)
  let BG_SELECTED = null;

  // offscreen alpha-applied art (or null to use original)
  let processedArt = null;



  // ===== State =====
  const state = {
    blank: null,            // Image (shirt)
    artImg: null,           // Image (uploaded art)
    art: { tx: STAGE.w * 0.5, ty: STAGE.h * 0.45, scale: 0.5 },
    dragging: false,
    dragMode: 'move',       // 'move' | 'scale'
    last: { x: 0, y: 0 },
    dpr: Math.min(window.devicePixelRatio || 1, 1.75),
  };

  let MANIFEST = null;      // loaded once from JSON
  let PPI_STAGE = null;     // stage px per real inch (per-blank)
  let BOX_PX = null;        // placement box in stage px (per-blank)

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
    // clamp scale
    const cap = maxScaleForPrintArea(state.artImg.width, state.artImg.height);
    const epsScale = CLAMP_EPS_PX / state.artImg.width;
    state.art.scale = Math.min(state.art.scale, cap - epsScale);

    // clamp position (keep the art's center inside the box)
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
    sizeReadout.textContent = s ? `${s.w_in.toFixed(2)}" W × ${s.h_in.toFixed(2)}" H` : '—';
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

    // Placement guide (only while dragging)
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

  const src = processedArt || state.artImg;     // <-- use masked if present
  const w = src.width  * state.art.scale;
  const h = src.height * state.art.scale;

  ctx.save();
  ctx.translate(state.art.tx, state.art.ty);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);     // <-- draw src
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
    state.art.tx = a.x + a.w / 2;     // center horizontally
    state.art.ty = a.y + scaledH / 2; // top-align
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
// --- Corner sampling & swatches --------------------------------------------
function sampleCornerColors(img) {
  const w = img.width, h = img.height, off = 2; // a couple px in from the edges
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently:true });
  cx.drawImage(img, 0, 0);

  const px = (x,y) => {
    const d = cx.getImageData(x,y,1,1).data;
    return [d[0], d[1], d[2]];
  };
  return [
    { rgb: px(off, off),         corners:new Set(['tl']) },
    { rgb: px(w-1-off, off),     corners:new Set(['tr']) },
    { rgb: px(off, h-1-off),     corners:new Set(['bl']) },
    { rgb: px(w-1-off, h-1-off), corners:new Set(['br']) }
  ];
}

function dedupeColors(samples, thresh=12) {
  const t2 = thresh*thresh;
  const groups = [];
  const d2 = (a,b)=> {
    const dr=a[0]-b[0], dg=a[1]-b[1], db=a[2]-b[2];
    return dr*dr + dg*dg + db*db;
  };
  for (const s of samples) {
    let g = groups.find(g => d2(g.rgb, s.rgb) <= t2);
    if (g) { s.corners.forEach(c=>g.corners.add(c)); }
    else groups.push({ rgb: s.rgb, corners: new Set([...s.corners]) });
  }
  return groups;
}

function renderSwatches(groups){
  if (!bgSwatches) return;
  bgSwatches.innerHTML = '';
  BG_SELECTED = null;

  groups.forEach((g, idx)=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed','false');
    btn.title = `Corner color ${idx+1}`;
    btn.style.cssText = `
      width:22px;height:22px;border-radius:4px;
      border:2px solid rgba(0,0,0,.25); outline:none; cursor:pointer;
      background: rgb(${g.rgb[0]},${g.rgb[1]},${g.rgb[2]});
    `;
    btn.addEventListener('click', ()=>{
      // radio behavior: only one selected
      [...bgSwatches.children].forEach(el=>el.classList.remove('selected'));
      btn.classList.add('selected');
      BG_SELECTED = g; // single active group
      rebuildProcessedArt();
    });
    bgSwatches.appendChild(btn);
  });
}

// --- Mask builders ----------------------------------------------------------
// apply 0..255 mask to pixels as alpha (min of existing and mask)
function applyMaskToImage(pixels, mask) {
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    pixels[i+3] = Math.min(pixels[i+3], mask[j]);
  }
}

// erode 1px to hide halos
function erodeMask(mask, w, h, iterations=1) {
  const tmp = new Uint8ClampedArray(mask.length);
  for (let it=0; it<iterations; it++){
    tmp.set(mask);
    for (let y=1; y<h-1; y++){
      for (let x=1; x<w-1; x++){
        const i = y*w + x;
        if (tmp[i] === 0) { mask[i] = 0; continue; }
        if (
          tmp[i-1]===0 || tmp[i+1]===0 || tmp[i-w]===0 || tmp[i+w]===0 ||
          tmp[i-w-1]===0 || tmp[i-w+1]===0 || tmp[i+w-1]===0 || tmp[i+w+1]===0
        ) mask[i] = 0;
      }
    }
  }
}

// tiny box blur feather (radius 0..3)
function blurMask(mask, w, h, radius=1) {
  if (radius<=0) return;
  const tmp = new Float32Array(mask.length);
  const r = Math.round(radius);

  // horizontal
  for (let y=0; y<h; y++){
    let sum=0, row=y*w;
    for (let x=-r; x<=r; x++) sum += mask[row + Math.max(0, Math.min(w-1, x))];
    for (let x=0; x<w; x++){
      tmp[row+x] = sum / (2*r+1);
      const add=x+r+1, sub=x-r;
      sum += mask[row + Math.min(w-1, Math.max(0, add))];
      sum -= mask[row + Math.max(0, sub)];
    }
  }
  // vertical
  for (let x=0; x<w; x++){
    let sum=0;
    for (let y=-r; y<=r; y++) sum += tmp[Math.max(0, Math.min(h-1, y))*w + x];
    for (let y=0; y<h; y++){
      const idx = y*w + x;
      mask[idx] = Math.round(sum / (2*r+1));
      const add=y+r+1, sub=y-r;
      sum += tmp[Math.min(h-1, Math.max(0, add))*w + x];
      sum -= tmp[Math.max(0, sub)*w + x];
    }
  }
}

// global threshold vs one target color
function makeMaskThresholdTarget(pixels, w, h, tol, outMask, targetRGB) {
  const tol2 = Math.pow((tol/100)*255, 2);
  const [tr,tg,tb] = targetRGB;
  for (let i=0, j=0; i<pixels.length; i+=4, j++){
    const r=pixels[i], g=pixels[i+1], b=pixels[i+2];
    const d2=(r-tr)**2 + (g-tg)**2 + (b-tb)**2;
    outMask[j] = (d2 < tol2) ? 0 : 255;
  }
}

// wand flood-fill from selected corners toward target color
function makeMaskWandSeeds(pixels, w, h, tol, outMask, target) {
  outMask.fill(255);
  const tol2 = Math.pow((tol/100)*255, 2);
  const visited = new Uint8Array(w*h);
  const q = [];
  const idxOf = { tl:0, tr:w-1, bl:(h-1)*w, br:w*h-1 };
  const [tr,tg,tb] = target.rgb;

  target.corners.forEach(c=>{
    const idx = idxOf[c];
    if (idx != null) q.push(idx);
  });

  while (q.length) {
    const idx = q.pop();
    if (visited[idx]) continue;
    visited[idx] = 1;

    const i4 = idx*4;
    const r=pixels[i4], g=pixels[i4+1], b=pixels[i4+2];
    const d2=(r-tr)**2 + (g-tg)**2 + (b-tb)**2;
    if (d2 >= tol2) continue;

    outMask[idx] = 0; // background (transparent)

    const x = idx % w, y = (idx / w)|0;
    if (x>0)   q.push(idx-1);
    if (x<w-1) q.push(idx+1);
    if (y>0)   q.push(idx-w);
    if (y<h-1) q.push(idx+w);
  }
}

// build processedArt based on BG settings + selected swatch
async function rebuildProcessedArt() {
  processedArt = null;
  if (!state.artImg || BG.mode === 'none') { scheduleDraw(); return; }

  const src = state.artImg;
  const w = src.width, h = src.height;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently:true });
  cx.drawImage(src, 0, 0);

  const imgData = cx.getImageData(0, 0, w, h);
  const mask = new Uint8ClampedArray(w*h);

  if (!BG_SELECTED) {
    // no swatch chosen → do nothing; same as 'none'
    processedArt = null;
    scheduleDraw();
    return;
  }

  if (BG.mode === 'threshold') {
    makeMaskThresholdTarget(imgData.data, w, h, BG.tol, mask, BG_SELECTED.rgb);
  } else { // 'wand'
    makeMaskWandSeeds(imgData.data, w, h, BG.tol, mask, BG_SELECTED);
  }

  // small cleanup + optional feather
  erodeMask(mask, w, h, 1);
  if (BG.feather > 0) blurMask(mask, w, h, BG.feather);

  applyMaskToImage(imgData.data, mask);
  cx.putImageData(imgData, 0, 0);
  processedArt = c;

  scheduleDraw();
}

  const fitArtToMaxArea = () => placeArtTopMaxWidth();

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
      state.blank = null;
      PPI_STAGE = null;
      BOX_PX = null;
      return scheduleDraw();
    }

    const items = await ensureManifest();
    const meta = items.find(m => m.file === filename) || null;

    const img = new Image();
    img.onload = () => {
      state.blank = img;

      // shirt-to-stage scale
      const bw = img.width, bh = img.height;
      const sBlank = Math.min(STAGE.w / bw, STAGE.h / bh);

      // px-per-inch on stage
      if (meta?.ref?.px && meta?.ref?.in) {
        PPI_STAGE = (meta.ref.px * sBlank) / meta.ref.in;
      } else {
        PPI_STAGE = null;
      }

      // placement box in stage px
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
      fitSelect(blankSelect);

      if (items.length) await setBlankFromFile(items[0].file);
    } catch (err) {
      console.error('Failed to load shirt manifest:', err);
      if (blankSelect) blankSelect.innerHTML = '<option value="">(No blanks found)</option>';
      state.blank = null; PPI_STAGE = null; BOX_PX = null;
      scheduleDraw();
    }
  }
// --- Fit <select> text to one line (auto-shrink if needed) ---
function fitSelect(el){
  if (!el) return;
  const cs = getComputedStyle(el);

  // available width inside padding (arrow space already reserved in CSS)
  const padL = parseFloat(cs.paddingLeft)||0;
  const padR = parseFloat(cs.paddingRight)||0;
  const avail = el.clientWidth - padL - padR;
  if (avail <= 0) return;

  // measure selected option with canvas, include style/variant/weight
  const mctx = fitSelect._ctx || (fitSelect._ctx = document.createElement('canvas').getContext('2d'));
  const fw = cs.fontWeight || '400';
  const fs = cs.fontStyle || 'normal';
  const fv = cs.fontVariant || 'normal';
  const basePx = parseFloat(cs.fontSize) || 16;
  mctx.font = `${fs} ${fv} ${fw} ${basePx}px ${cs.fontFamily}`;

  const txt = (el.options[el.selectedIndex] && el.options[el.selectedIndex].text) || '';
  const textW = mctx.measureText(txt).width;

  const scale = Math.min(1, avail / Math.max(1, textW));
  const minPx = 12; // don’t go microscopic
  el.style.fontSize = `${Math.max(minPx, basePx * scale)}px`;
}

function fitAllSelects(){ document.querySelectorAll('select').forEach(fitSelect); }

// run after layout stabilizes & fonts load
function fitAllSelectsSoon(){
  requestAnimationFrame(()=>requestAnimationFrame(fitAllSelects));
}

// observe size changes (panel width, media queries, etc.)
const selectRO = new ResizeObserver(entries => {
  for (const e of entries) fitSelect(e.target);
});
window.addEventListener('load', () => {
  document.querySelectorAll('select').forEach(el => selectRO.observe(el));
  fitAllSelectsSoon();
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAllSelectsSoon);

// refit when a select’s value changes
document.addEventListener('change', e => {
  if (e.target.tagName === 'SELECT') fitSelect(e.target);
});


  function labelFromFilename(name) {
    const base = name.replace(/\.[^.]+$/, '');
    return base.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ===== Events =====

  // Upload button triggers hidden input
  if (artBtn && artInput) artBtn.addEventListener('click', () => artInput.click());

  if (artInput) {
    artInput.addEventListener('change', async () => {
      const f = artInput.files && artInput.files[0];
      if (!f) { if (artNameEl) artNameEl.textContent = '(No file selected)'; return; }
      if (artNameEl) artNameEl.textContent = f.name;
      state.artImg = await loadImageFromFile(f);
      placeArtTopMaxWidth();             // initial fit & place
      const sampled = sampleCornerColors(state.artImg);
      const groups = dedupeColors(sampled, 12); // 12 ≈ gentle de-dupe
      renderSwatches(groups);     // builds the row of radio-like squares
      rebuildProcessedArt();      // renders with current BG settings (mode defaults to 'none')
    });
  }

  if (blankSelect) {
    blankSelect.addEventListener('change', (e) => setBlankFromFile(e.target.value || ''));
  }

  if (centerBtn) centerBtn.addEventListener('click', centerArt);
  if (fitBtn) fitBtn.addEventListener('click', fitArtToMaxArea);

  // ----- Pointer events (mouse/touch/pen) -----
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

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = null;
    if (pointers.size === 0) {
      state.dragging = false;   // hide guide next frame
      scheduleDraw();
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerout', endPointer);   // also end if pointer leaves canvas

  // Prevent iOS page scroll while manipulating
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // Resize
  window.addEventListener('resize', setCanvasSize);
  window.addEventListener('orientationchange', setCanvasSize);

  // ===== Boot =====
  setCanvasSize();
  loadShirtManifest();
  fitSelect(blankSelect);

})();
