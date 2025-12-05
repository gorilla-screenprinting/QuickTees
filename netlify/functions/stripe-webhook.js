// netlify/functions/stripe-webhook.js
const { google } = require('googleapis');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sigHeader, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: 'Bad signature' };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;

  try {
    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };

    // Full session for lines + payment intent
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items.data.price.product', 'payment_intent'],
    });

    const spreadsheetId = process.env.ORDERS_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('Missing ORDERS_SPREADSHEET_ID; skipping sheet write.');
      return { statusCode: 200, body: 'ok' };
    }

    // ---------- Build consistent orderId ----------
    const metaOrderId = session.metadata?.orderId || '';
    const fallbackOrderId = `QT-${session.created}`; // UNIX seconds; stable for a given session
    const orderId = (metaOrderId && String(metaOrderId).trim()) || fallbackOrderId;

    // ---------- Parse metadata items we sent from create-checkout ----------
    let metaItems = [];
    let mockups = {};
    try {
      const itemsJson = session.metadata?.items || '[]';
      const parsed = JSON.parse(itemsJson);
      metaItems = Array.isArray(parsed) ? parsed : [];
    } catch { metaItems = []; }
    try {
      const mJson = session.metadata?.mockups || '{}';
      const parsedM = JSON.parse(mJson);
      if (parsedM && typeof parsedM === 'object') mockups = parsedM;
    } catch { mockups = {}; }

    // Stripe line items (expected order: [G1, D1, G2, D2, ...])
    const li = fullSession.line_items?.data || [];
    const pairs = [];
    for (let i = 0; i < metaItems.length; i++) {
      pairs.push({
        meta: metaItems[i],
        garment: li[2 * i] || null,
        deco: li[2 * i + 1] || null,
      });
    }

    // ---------- Prepare Orders row (your exact headers) ----------
    const createdAt = new Date((session.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
    const status = 'PAID';
    const email = session.customer_details?.email || session.customer_email || '';
    const customerName = session.customer_details?.name || session.metadata?.customerName || '';
    const customerPhone = session.customer_details?.phone || session.metadata?.customerPhone || '';

    const subtotal = n((session.amount_subtotal ?? 0) / 100);
    const tax = n((session.total_details?.amount_tax ?? 0) / 100);
    // Shipping can be in shipping_cost.amount_total, or in total_details.amount_shipping
    const shipping = n(
      (session.shipping_cost?.amount_total ??
        session.total_details?.amount_shipping ??
        0) / 100
    );
    const total = n((session.amount_total ?? 0) / 100);

    const source = 'QuickTees+Stripe';
    const paymentIntentId = fullSession.payment_intent?.id || '';
    // The checkout URL usually isn’t present in the webhook; leave blank if unknown
    const checkoutUrl = session.url || '';
    const currency = (session.currency || 'usd').toUpperCase();

    // ---------- Idempotency check (avoid duplicates) ----------
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Orders sheet: A:X (includes mockups, folderLink placeholder, shipping addr, orderNote)
    const ordersRange = 'Orders!A:X';
    const existingOrders = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: ordersRange,
    });
    const rows = existingOrders.data.values || [];
    const already = rows.some((r, i) => {
      if (i === 0) return false; // skip header
      const rowOrderId = (r[0] || '').trim(); // col A
      const rowPi = (r[11] || '').trim();     // col L (paymentIntentId)
      return rowOrderId === orderId || rowPi === paymentIntentId;
    });

    if (!already) {
      const shippingDetails = session.shipping_details || {};
      const shipAddr = shippingDetails.address || {};
      const shipName = shippingDetails.name || '';
      const shipLine1 = shipAddr.line1 || '';
      const shipLine2 = shipAddr.line2 || '';
      const shipCity = shipAddr.city || '';
      const shipState = shipAddr.state || '';
      const shipPostal = shipAddr.postal_code || '';
      const shipCountry = shipAddr.country || '';
      const orderNote = session.metadata?.orderNote || '';
      const mockupsStr = mockups && (mockups.front || mockups.back) ? JSON.stringify(mockups) : '';

      const ordersRow = [
        orderId,         // A: orderId
        createdAt,       // B: createdAt
        status,          // C: status
        email,           // D: email
        customerName,    // E: customerName
        customerPhone,   // F: customerPhone
        subtotal,        // G: subtotal
        tax,             // H: tax
        shipping,        // I: shipping
        total,           // J: total
        source,          // K: source
        paymentIntentId, // L: paymentIntentId
        checkoutUrl,     // M: checkoutUrl
        currency,        // N: currency
        mockupsStr,      // O: mockups JSON (front/back gs://)
        '',              // P: folderLink (filled by Apps Script)
        shipName,        // Q: shipping name
        shipLine1,       // R: shipping line1
        shipLine2,       // S: shipping line2
        shipCity,        // T: shipping city
        shipState,       // U: shipping state
        shipPostal,      // V: shipping postal
        shipCountry,     // W: shipping country
        orderNote        // X: order note
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: ordersRange,
        valueInputOption: 'RAW',
        requestBody: { values: [ordersRow] },
      });
      console.log('✅ Orders row written:', orderId);
    } else {
      console.log('Orders row already exists for', orderId);
    }

    // ---------- Prepare OrderLines rows (your exact headers) ----------
    // OrderLines headers:
    // orderId | designLabel | fileId | garmentSKU | placement | sizesJson | tier | readoutW_in | readoutH_in
    // garment_unit | garment_qty | garment_subtotal | decoration_sku | decoration_unit | decoration_qty | decoration_subtotal | line_total
    const childRows = [];

    for (const p of pairs) {
      const meta = p.meta || {};
      const g = p.garment;
      const d = p.deco;

      const qty = Number(g?.quantity) || Number(d?.quantity) || 0;

      const garment_unit = g?.price?.unit_amount ? (g.price.unit_amount / 100) : 0;
      const decoration_unit = d?.price?.unit_amount ? (d.price.unit_amount / 100) : 0;

      const garment_subtotal = garment_unit * qty;
      const decoration_subtotal = decoration_unit * qty;
      const line_total = garment_subtotal + decoration_subtotal;

      const sizesJson = JSON.stringify(meta.sizeRun || {});
      const readW = (meta.readoutIn?.w_in ?? '') || '';
      const readH = (meta.readoutIn?.h_in ?? '') || '';
      const placement = (meta.placement || 'front').toLowerCase() === 'back' ? 'back' : 'front';
      const t = Number(meta.tierIn);
      const decoration_sku = [4, 8, 12, 16].includes(t) ? `dtf-${t}-${placement}` : '';

      const fileId = meta.fileId || meta.f || meta.b || '';

      childRows.push([
        orderId,                         // orderId (FK)
        meta.designLabel || 'Design',    // designLabel
        fileId,                          // fileId
        meta.garmentSKU || '',           // garmentSKU
        placement,                       // placement
        sizesJson,                       // sizesJson
        (meta.tierIn ?? ''),             // tier
        readW,                           // readoutW_in
        readH,                           // readoutH_in
        Number(garment_unit.toFixed(2)),     // garment_unit
        qty,                                 // garment_qty
        Number(garment_subtotal.toFixed(2)), // garment_subtotal
        decoration_sku,                      // decoration_sku
        Number(decoration_unit.toFixed(2)),  // decoration_unit
        qty,                                 // decoration_qty
        Number(decoration_subtotal.toFixed(2)), // decoration_subtotal
        Number(line_total.toFixed(2))        // line_total
      ]);
    }

    if (childRows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'OrderLines!A:Q',
        valueInputOption: 'RAW',
        requestBody: { values: childRows },
      });
      console.log('OrderLines rows written:', childRows.length);
    } else {
      console.log('No OrderLines to write.');
    }

  } catch (err) {
    console.error('❌ Webhook processing failed:', err);
    // keep 200 so Stripe doesn’t retry forever while you iterate
    return { statusCode: 200, body: 'ok' };
  }

  return { statusCode: 200, body: 'ok' };
};
