// netlify/functions/create-order.js
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const email = body?.customer?.email || '';
  if (!email) {
    return { statusCode: 400, body: 'Missing customer email' };
  }

  let subtotal = 0;
  for (const it of (body.items || [])) {
    const qty = Number(it?.qty || 0);
    const unit = Number(it?.unit || 0);
    subtotal += qty * unit;
  }
  const tax = +(subtotal * 0.10).toFixed(2);
  const shipping = 0;
  const grandTotal = +(subtotal + tax + shipping).toFixed(2);

  const payload = {
    orderId: `QT-${Date.now()}`,
    status: 'PENDING_PAYMENT',
    totals: { subtotal, tax, shipping, grandTotal },
    createdAt: new Date().toISOString()
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
};
