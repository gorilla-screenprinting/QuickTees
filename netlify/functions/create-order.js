// netlify/functions/create-order.js
const { google } = require('googleapis');

module.exports.handler = async function handler(event) {
  // Only POST allowed
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Parse JSON body
    const body = JSON.parse(event.body || '{}');

    // Minimal validation
    const email = body?.customer?.email || '';
    if (!email) {
      return { statusCode: 400, body: 'Missing customer info (email required).' };
    }

    // Compute basics
    const orderId = `QT-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const status = 'PENDING_PAYMENT';

    // Totals (MVP): sum qty*unit, 10% tax, $0 shipping
    let subtotal = 0;
    for (const it of (body.items || [])) {
      const qty = Number(it?.qty || 0);
      const unit = Number(it?.unit || 0);
      subtotal += qty * unit;
    }
    const tax = +(subtotal * 0.10).toFixed(2);
    const shipping = 0;
    const grandTotal = +(subtotal + tax + shipping).toFixed(2);

    // Prepare row in the exact header order we set up
    const row = [
      orderId,                             // A: orderId
      createdAt,                           // B: createdAt (ISO string)
      status,                              // C: status
      email,                               // D: customerEmail
      body?.customer?.name || '',          // E: customerName
      body?.customer?.phone || '',         // F: customerPhone
      JSON.stringify(body.items || []),    // G: itemsJson
      body?.art?.fileId || '',             // H: artFileId
      body?.art?.webViewLink || '',        // I: artWebViewLink
      body?.art?.notes || '',              // J: notes
      subtotal,                            // K: subtotal
      tax,                                 // L: tax
      shipping,                            // M: shipping
      grandTotal,                          // N: grandTotal
      event.headers['idempotency-key'] || '', // O: idempotencyKey
      body?.meta?.source || 'QuickTees'    // P: source
    ];

    // Auth with service account (same JSON used for Drive)
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Append to the Orders tab (A:P to match 16 columns)
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.ORDERS_SPREADSHEET_ID,
      range: 'Orders!A:P',                 // <-- Ensure the tab is named exactly "Orders"
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });

    // Success
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId,
        status,
        totals: { subtotal, tax, shipping, grandTotal },
        createdAt
      })
    };
  } catch (err) {
    console.error('create-order error:', err);
    return { statusCode: 500, body: `Server error: ${err.message}` };
  }
};
