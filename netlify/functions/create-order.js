// netlify/functions/create-order.js
const { google } = require('googleapis');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) Parse + validate
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }
  const email = body?.customer?.email || '';
  if (!email) return { statusCode: 400, body: 'Missing customer email' };

  const idemKey = event.headers['idempotency-key'] || '';

  // 2) Auth Sheets
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 3) If Idempotency-Key present, try to find existing row
  if (idemKey) {
    // Read a reasonable recent window; adjust if you expect huge volume
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.ORDERS_SPREADSHEET_ID,
      range: 'Orders!A:P'
    });
    const rows = read.data.values || [];
    // Skip header row; find a row where column O (index 14) == idemKey
    const found = rows.find((r, idx) => idx > 0 && (r[14] || '') === idemKey);
    if (found) {
      // Columns: A orderId, K subtotal, L tax, M shipping, N grandTotal, C status, B createdAt
      const [orderId,, status,, , , , , , , subtotal, tax, shipping, grandTotal] = [
        found[0], null, found[2], null, null, null, null, null, null, null,
        Number(found[10] || 0),
        Number(found[11] || 0),
        Number(found[12] || 0),
        Number(found[13] || 0)
      ];
      const createdAt = (rows[0] && rows[0][1]) ? found[1] : found[1]; // B
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          status: status || 'PENDING_PAYMENT',
          totals: { subtotal, tax, shipping, grandTotal },
          createdAt
        })
      };
    }
  }

  // 4) Compute totals (new order)
  let subtotal = 0;
  for (const it of (body.items || [])) {
    const qty = Number(it?.qty || 0);
    const unit = Number(it?.unit || 0);
    subtotal += qty * unit;
  }
  const tax = +(subtotal * 0.10).toFixed(2);
  const shipping = 0;
  const grandTotal = +(subtotal + tax + shipping).toFixed(2);

  // 5) Build row & append
  const orderId = `QT-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const status = 'PENDING_PAYMENT';

  const row = [
    orderId,                               // A
    createdAt,                             // B
    status,                                // C
    email,                                 // D
    body?.customer?.name || '',            // E
    body?.customer?.phone || '',           // F
    JSON.stringify(body.items || []),      // G
    body?.art?.fileId || '',               // H
    body?.art?.webViewLink || '',          // I
    body?.art?.notes || '',                // J
    subtotal,                              // K
    tax,                                   // L
    shipping,                              // M
    grandTotal,                            // N
    idemKey,                               // O (idempotencyKey)
    body?.meta?.source || 'QuickTees'      // P
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.ORDERS_SPREADSHEET_ID,
      range: 'Orders!A:P',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
  } catch (err) {
    console.error('Sheets append failed:', err);
    return { statusCode: 500, body: `Sheets error: ${err.message}` };
  }

  // 6) Return new order
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
