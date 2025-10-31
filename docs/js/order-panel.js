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

  function computeTotals() {
    const qty = Math.max(0, Number(el.qty?.value || 0));
    const unit = Math.max(0, Number(el.unit?.value || 0));
    const subtotal = +(qty * unit).toFixed(2);
    const tax = +((subtotal * 0.10)).toFixed(2); // keep in sync with backend
    const shipping = 0;
    const grandTotal = +(subtotal + tax + shipping).toFixed(2);

    if (el.sub) el.sub.textContent = fmt(subtotal);
    if (el.tax) el.tax.textContent = fmt(tax);
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
  if (el.btnPlace) el.btnPlace.addEventListener('click', placeOrder);
  if (el.btnReview) el.btnReview.addEventListener('click', () => {
    const t = computeTotals();
    alert(`Review\nSubtotal: ${fmt(t.subtotal)}\nTax: ${fmt(t.tax)}\nTotal: ${fmt(t.grandTotal)}`);
  });
})();
