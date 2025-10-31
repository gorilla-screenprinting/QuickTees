// js/order-panel-shell.js
(() => {
  const panel  = document.getElementById('qtOrderPanel');
  const handle = document.getElementById('qtPanelHandle');
  const close  = document.getElementById('qtPanelClose');

  if (!panel || !handle) return;

  let lastFocused = null;

  const isOpen = () => panel.classList.contains('is-open');

  function openPanel(){
    if (isOpen()) return;
    lastFocused = document.activeElement;
    panel.classList.add('is-open');
    handle.setAttribute('aria-expanded','true');
    panel.setAttribute('aria-hidden','false');

    // Lock background scroll
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.touchAction = 'none';

    // Focus close (or panel)
    (close || panel).focus?.({ preventScroll:true });

    document.addEventListener('keydown', onKeydown);
  }

  function closePanel(){
    if (!isOpen()) return;
    panel.classList.remove('is-open');
    handle.setAttribute('aria-expanded','false');
    panel.setAttribute('aria-hidden','true');

    // Restore scroll
    document.documentElement.style.overflow = '';
    document.documentElement.style.touchAction = '';

    document.removeEventListener('keydown', onKeydown);
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll:true });
  }

  function togglePanel(){ isOpen() ? closePanel() : openPanel(); }

  function onKeydown(e){ if (e.key === 'Escape') closePanel(); }

  handle.addEventListener('click', togglePanel);
  close?.addEventListener('click', closePanel);

  // Optional: expose tiny API if you ever need it
  window.QTPanel = { open: openPanel, close: closePanel, toggle: togglePanel, el: panel };
})();
