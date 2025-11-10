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

// ---- Minimal Checkout wiring (legacy body shape) ----
(function () {
  const placeBtn = document.getElementById('qtPlaceBtn');
  if (!placeBtn) return;

  placeBtn.addEventListener('click', async () => {
    try {
      const emailEl = document.getElementById('qtEmail');
      const qtyEl = document.getElementById('qtQty');
      const notesEl = document.getElementById('qtNotes');
      const blankEl = document.getElementById('blankSelect');

      const email = (emailEl && emailEl.value || '').trim();
      const qty = parseInt(qtyEl && qtyEl.value, 10) || 1;
      if (qty >= 36) { alert('Orders of 36+ are screenprint-only. Contact us for a quote.'); return; }
      const note = notesEl ? notesEl.value : '';
      const garmentSKU = (blankEl && blankEl.value || '').trim();

      // state from earlier steps
      const fileId = (window.orderState && window.orderState.fileId) || '';
      const tierIn = window.orderState?.currentTier?.tierIn || null;
      const tooLarge = !!window.orderState?.currentTier?.tooLarge;
      const readoutIn = window.orderState?.readoutIn || null;

      // simple guards
      if (!email) { alert('Enter a valid email.'); return; }
      if (!fileId) { alert('Upload your artwork before placing the order.'); return; }
      if (tooLarge) { alert('Too large for DTF — max 16".'); return; }
      if (!garmentSKU) { alert('Pick a shirt blank.'); return; }

      // Legacy body your server understands (no items[])
      const body = {
        email,
        customerName: (document.getElementById('qtName')?.value || '').trim(),
        customerPhone: (document.getElementById('qtPhone')?.value || '').trim(),
        productId: garmentSKU,        // server maps this to garment SKU
        placement: 'front',           // keep simple for now
        sizeRun: { L: qty },          // total qty (grid coming later)
        fileId,
        orderNote: note,
        tierIn,
        readoutIn
      };

      // POST to Netlify function
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
        window.location.href = data.url; // redirect to Stripe Checkout
      } else {
        alert('Unexpected response from checkout.');
      }
    } catch (err) {
      console.error('Place error', err);
      alert('Could not start checkout.');
    }
  });
})();
