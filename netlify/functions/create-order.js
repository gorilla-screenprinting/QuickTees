// netlify/functions/create-order.js
const { google } = require('googleapis');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) Parse + basic validation
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

  // 2) Compute totals
  let subtotal = 0;
  for (const it of (body.items || [])) {
    const qty = Number(it?.qty || 0);
    const unit = Number(it?.unit || 0);
    subtotal += qty * unit;
  }
  const tax = +(subtotal * 0.10).toFixed(2);
  const shipping = 0;
  const grandTotal = +(subtotal + tax + shipping).toFixed(2);

  // 3) Build response payload + row
  const orderId = `QT-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const status = 'PENDING_PAYMENT';

  const row = [
    orderId,                             // A: orderId
    createdAt,                           // B: createdAt (ISO)
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

  // 4) Append to Google Sheets
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.ORDERS_SPREADSHEET_ID,
      range: 'Orders!A:P',                 // Tab must be named exactly "Orders"
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
  } catch (err) {
    console.error('Sheets append failed:', err);
    return { statusCode: 500, body: `Sheets error: ${err.message}` };
  }

  // 5) Success response
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
};
