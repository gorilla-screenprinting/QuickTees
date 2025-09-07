// netlify/functions/create-order.js
const { google } = require('googleapis');

// Safe number caster (avoids NaN -> JSON null)
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse + validate
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }
  const email = body?.customer?.email || '';
  if (!email) return { statusCode: 400, body: 'Missing customer email' };

  const idemKey = event.headers['idempotency-key'] || '';

  // Sheets auth
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // If Idempotency-Key present, try to return existing row (no new write)
  if (idemKey) {
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.ORDERS_SPREADSHEET_ID,
      range: 'Orders!A:P'
    });
    const rows = read.data.values || [];
    // Header is row 0; O column is index 14
    const found = rows.find((r, i) => i > 0 && (r[14] || '') === idemKey);
    if (found) {
      const orderId    = found[0] || '';
      const createdAt  = found[1] || '';
      const status     = found[2] || 'PENDING_PAYMENT';
      const subtotal   = n(found[10]);
      const tax        = n(found[11]);
      const shipping   = n(found[12]);
      const grandTotal = n(found[13]);

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
    }
  }

  // Compute new totals from request
  const items = Array.isArray(body.items) ? body.items : [];
  const subtotal = items.reduce((s, it) => s + n(it?.qty) * n(it?.unit), 0);
  const tax = Math.round(subtotal * 0.10 * 100) / 100;
  const shipping = 0;
  const grandTotal = Math.round((subtotal + tax + shipping) * 100) / 100;

  // Build row & append
  const orderId = `QT-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const status = 'PENDING_PAYMENT';

  const row = [
    orderId,                           // A
    createdAt,                         // B
    status,                            // C
    email,                             // D
    body?.customer?.name || '',        // E
    body?.customer?.phone || '',       // F
    JSON.stringify(items),             // G
    body?.art?.fileId || '',           // H
    body?.art?.webViewLink || '',      // I
    body?.art?.notes || '',            // J
    subtotal,                          // K
    tax,                               // L
    shipping,                          // M
    grandTotal,                        // N
    idemKey,                           // O
    body?.meta?.source || 'QuickTees'  // P
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
};
