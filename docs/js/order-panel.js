// ===== QuickTees Order Panel wiring (standalone) =====
(function () {
  const $ = (id) => document.getElementById(id);

  const el = {
    email: $('qtEmail'),
    name: $('qtName'),
    phone: $('qtPhone'),
    qty: $('qtQty'),
    unit: $('qtUnit'),
    notes: $('qtNotes'),
    sub: $('qtSubtotal'),
    tax: $('qtTax'),
    ship: $('qtShipping'),
    total: $('qtTotal'),
    btnReview: $('qtReviewBtn'),
    btnPlace: $('qtPlaceBtn')
  };

  const fmt = (n) => (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

  // Client-side shipping mirror (uses window.QT_SHIPPING if you inject one later)
  let SHIPPING_CLIENT = {
    model: 'count',
    // ⬇️ Paste the SAME brackets you use on the server (amount_cents)
    // Example structure:
    // brackets: [
    //   { min: 1,  max: 4,  amount_cents: 1200 },
    //   { min: 5,  max: 10, amount_cents: 2000 },
    //   { min: 11, max: 18, amount_cents: 3000 },
    //   { min: 19, max: 24, amount_cents: 3800 },
    //   { min: 25, max: 35, amount_cents: 4500 }
    // ]
    brackets: [] // <- keep empty for now if you haven’t decided exact amounts
  };

  function pickShipCentsByCount(count) {
    if (!SHIPPING_CLIENT || SHIPPING_CLIENT.model !== 'count') return 0;
    const b = (SHIPPING_CLIENT.brackets || []).find(x => count >= x.min && count <= x.max);
    return b ? (b.amount_cents | 0) : 0;
  }

  // Load shipping table from server (same file used by the backend)
  fetch('/.netlify/functions/shipping-config')
    .then(r => r.ok ? r.json() : null)
    .then(cfg => {
      if (cfg && cfg.model === 'count' && Array.isArray(cfg.brackets)) {
        SHIPPING_CLIENT = cfg;
        // Recompute to reflect real shipping
        try { computeTotals(); } catch (_) { }
      }
    })
    .catch(() => { /* non-fatal: UI keeps $0 shipping preview */ });


  function computeTotals() {
    const qty = Math.max(0, Number(el.qty?.value || 0));
    const unit = Math.max(0, Number(el.unit?.value || 0));
    const subtotal = +(qty * unit).toFixed(2);
    const tax = null; // Stripe calculates at Checkout
    const shippingCents = pickShipCentsByCount(qty);
    const shipping = +(shippingCents / 100).toFixed(2);
    const grandTotal = +(subtotal + shipping).toFixed(2);

    if (el.sub) el.sub.textContent = fmt(subtotal);
    if (el.tax) el.tax.textContent = 'Calculated at checkout';
    if (el.ship) el.ship.textContent = fmt(shipping);
    if (el.total) el.total.textContent = fmt(grandTotal);

    return { subtotal, tax, shipping, grandTotal, qty, unit };
  }

  async function placeOrder() {
    if (!el.btnPlace) return;

    const email = (el.email?.value || '').trim();
    if (!email) { alert('Please enter your email.'); return; }

    const totals = computeTotals();
    if (totals.subtotal <= 0) { alert('Subtotal must be greater than $0.'); return; }

    el.btnPlace.disabled = true;
    if (el.btnReview) el.btnReview.disabled = true;

    const payload = {
      customer: { email, name: el.name?.value || '', phone: el.phone?.value || '' },
      items: [{ qty: totals.qty, unit: totals.unit }],
      art: { notes: el.notes?.value || '' },
      meta: { source: 'QuickTees' }
    };

    try {
      const res = await fetch('/.netlify/functions/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `QT-${Date.now()}`
        },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text);
      alert(`Order placed (simulated)\n# ${data.orderId}\nTotal: ${fmt(data.totals.grandTotal)}`);
      console.log('Simulated order:', data);
    } catch (err) {
      console.error(err);
      alert('Order failed: ' + err.message);
    } finally {
      el.btnPlace.disabled = false;
      if (el.btnReview) el.btnReview.disabled = false;
    }
  }

  // Wire events if panel exists
  if (el.qty && el.unit) {
    el.qty.addEventListener('input', computeTotals);
    el.unit.addEventListener('input', computeTotals);
    computeTotals();
  }
  if (el.btnReview) el.btnReview.addEventListener('click', () => {
    const t = computeTotals();
    alert(`Review\nSubtotal: ${fmt(t.subtotal)}\nTax: ${fmt(t.tax)}\nTotal: ${fmt(t.grandTotal)}`);
  });
})();

// ---- Two-sided: minimal side state + toggle wiring ----
(function () {
  // Ensure a shared orderState exists
  window.orderState = window.orderState || {};

  // Sides container (front/back state lives here)
  window.orderState.sides = window.orderState.sides || {
    front: { fileId: '', designLabel: '', readoutIn: null, tierIn: null, placement: 'front' },
    back:  { fileId: '', designLabel: '', readoutIn: null, tierIn: null, placement: 'back'  }
  };
  // Active side (default front)
  window.orderState.activeSide = window.orderState.activeSide || 'front';

  const sideFrontBtn = document.getElementById('qtSideFront');
  const sideBackBtn  = document.getElementById('qtSideBack');

  function setActiveSide(side){
    const s = (side === 'back') ? 'back' : 'front';
    window.orderState.activeSide = s;

    // Toggle button states
    if (sideFrontBtn && sideBackBtn) {
      sideFrontBtn.setAttribute('aria-selected', String(s === 'front'));
      sideBackBtn.setAttribute('aria-selected',  String(s === 'back'));
    }

    // Notify the rest of the app (stage, upload UI, etc.)
    document.dispatchEvent(new CustomEvent('qt:side-changed', { detail: { side: s } }));

    // If you already have a render method, you can call it here:
    if (typeof window.renderStage === 'function') {
      try { window.renderStage(); } catch {}
    }
  }

  if (sideFrontBtn) sideFrontBtn.addEventListener('click', () => setActiveSide('front'));
  if (sideBackBtn)  sideBackBtn.addEventListener('click',  () => setActiveSide('back'));

  // Initialize the correct visual state on load
  setActiveSide(window.orderState.activeSide);
})();





// ---- Minimal Checkout wiring (size breakdown, text inputs) ----
(function () {
  const placeBtn = document.getElementById('qtPlaceBtn');
  if (!placeBtn) return;

  placeBtn.addEventListener('click', async () => {
    try {
      const emailEl = document.getElementById('qtEmail');
      const notesEl = document.getElementById('qtNotes');
      const blankEl = document.getElementById('blankSelect');

      const email = (emailEl && emailEl.value || '').trim();
      const note = notesEl ? notesEl.value : '';
      const garmentSKU = (blankEl && blankEl.value || '').trim();

      // sizes → sizeRun (strip non-digits so text inputs behave like numbers)
      const ids = [
        ['XS','qtSzXS'],
        ['SM','qtSzSM'],
        ['MD','qtSzMD'],
        ['LG','qtSzLG'],
        ['XL','qtSzXL'],
        ['2X','qtSz2X'],
        ['3X','qtSz3X'],
      ];
      const sizeRun = {};
      let totalQty = 0;
      for (const [label, id] of ids) {
        const raw = (document.getElementById(id)?.value || '').replace(/\D+/g, '');
        const v = parseInt(raw, 10) || 0;
        if (v > 0) { sizeRun[label] = v; totalQty += v; }
      }

      // placement (front/back)
      const placement = document.querySelector('input[name="qtPlacement"]:checked')?.value || 'front';

      // state from earlier steps
      const fileId = (window.orderState && window.orderState.fileId) || '';
      const tierIn = window.orderState?.currentTier?.tierIn || null;
      const tooLarge = !!window.orderState?.currentTier?.tooLarge;
      const readoutIn = window.orderState?.readoutIn || null;

      // guards
      if (!email) { alert('Enter a valid email.'); return; }
      if (!fileId) { alert('Upload your artwork before placing the order.'); return; }
      if (tooLarge) { alert('Too large for DTF — max 16".'); return; }
      if (!garmentSKU) { alert('Pick a shirt blank.'); return; }
      if (totalQty <= 0) { alert('Enter at least one shirt across sizes.'); return; }
      if (totalQty >= 36) { alert('Orders of 36+ are screenprint-only. Contact us for a quote.'); return; }

      // Request body (legacy single item shape your server supports)
      const body = {
        email,
        customerName: (document.getElementById('qtName')?.value || '').trim(),
        customerPhone: (document.getElementById('qtPhone')?.value || '').trim(),
        productId: garmentSKU,   // server maps this to garment SKU
        placement,               // 'front' or 'back'
        sizeRun,                 // e.g., { XS:2, LG:5, '2X':1 }
        fileId,
        orderNote: note,
        tierIn,
        readoutIn
      };

      const res = await fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        alert(`Checkout error: ${txt || res.status}`);
        return;
      }

      const data = await res.json();
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        alert('Unexpected response from checkout.');
      }
    } catch (err) {
      console.error('Place error', err);
      alert('Could not start checkout.');
    }
  });
})();
