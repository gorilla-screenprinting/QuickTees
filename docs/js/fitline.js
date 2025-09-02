// js/fitline.js — pixel-perfect one-line fit for elements with .fitline
(function () {
  // Single hidden measurer we reuse
  const measurer = document.createElement('span');
  Object.assign(measurer.style, {
    position: 'fixed',
    left: '-9999px',
    top: '0',
    whiteSpace: 'nowrap',
    visibility: 'hidden',
    lineHeight: '1',
  });
  document.documentElement.appendChild(measurer);

  function copyTextStyles(from, to) {
    const cs = getComputedStyle(from);
    // copy only what affects width
    to.style.fontFamily   = cs.fontFamily;
    to.style.fontWeight   = cs.fontWeight;
    to.style.fontStyle    = cs.fontStyle;
    to.style.fontVariant  = cs.fontVariant;
    to.style.letterSpacing= cs.letterSpacing;
    to.style.textTransform= cs.textTransform;
  }

  function fitOne(el) {
    if (!el) return;
    // Make sure the element itself defines the available width
    const available = el.clientWidth || el.getBoundingClientRect().width || 0;
    if (!available) return;

    const min = +(el.dataset.min || 12);
    const max = +(el.dataset.max || 200);
    const safety = +(el.dataset.safety || 0.995); // how close to the edge we go

    // What text are we fitting?
    const text = el.textContent.trim(); // ignore stray whitespace like &nbsp; indents
    if (!text) return;

    // Measure text at a known size, then scale
    copyTextStyles(el, measurer);
    const testPx = 100;               // known size to measure at
    measurer.style.fontSize = testPx + 'px';
    measurer.textContent = text;
    const widthAtTest = measurer.scrollWidth || 1;

    // width grows linearly with font-size -> solve for needed size
    const needed = (available / widthAtTest) * testPx * safety;
    const clamped = Math.max(min, Math.min(max, Math.floor(needed)));

    // Apply
    el.style.fontSize = clamped + 'px';
    el.style.lineHeight = '1.15';
  }

  function fitAll() {
    document.querySelectorAll('.fitline').forEach(fitOne);
  }

  // Re-run when the layout or fonts change
  let ticking = false;
  const onResize = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; fitAll(); });
  };

  window.addEventListener('resize', onResize);
  window.addEventListener('load', () => {
    const run = () => { fitAll(); new ResizeObserver(onResize).observe(document.body); };
    (document.fonts && 'ready' in document.fonts) ? document.fonts.ready.then(run) : run();
  });
})();
