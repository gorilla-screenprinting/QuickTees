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

  // Get the raw body exactly as Stripe sent it
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

  // Handle successful checkout
if (stripeEvent.type === 'checkout.session.completed') {
  const session = stripeEvent.data.object;

  // Keep the log
  console.log('PAID:', {
    sessionId: session.id,
    email: session.customer_details?.email || session.customer_email || '',
    metadata: session.metadata || {},
    amount_total: session.amount_total,
    currency: session.currency
  });

  // ==== WRITE PAID ORDER TO GOOGLE SHEET (create a new row; idempotent by session.id) ====
  try {
    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };

    // Auth for Sheets using the same Service Account JSON
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = process.env.ORDERS_SPREADSHEET_ID;
    const range = 'Orders!A:P';

    if (!spreadsheetId) {
      console.error('Missing ORDERS_SPREADSHEET_ID; skipping sheet write.');
    } else {
      // Prevent duplicates: use Stripe session.id as unique key in column O (index 14)
      const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = existing.data.values || [];
      const already = rows.some((r, i) => i > 0 && (r[14] || '') === session.id);

      if (already) {
        console.log('Sheet row already exists for', session.id);
      } else {
        const orderId    = `QT-${Date.now()}`;           // A
        const createdAt  = new Date().toISOString();     // B
        const status     = 'PAID';                       // C
        const email      = session.customer_details?.email || session.customer_email || ''; // D
        const name       = session.customer_details?.name || '';    // E
        const phone      = session.customer_details?.phone || '';   // F

        // Minimal items capture; you can enrich later
        const itemsJson  = JSON.stringify([
          { price: session.metadata?.priceId || process.env.PRICE_ID, qty: 1 }
        ]);                                             // G

        const fileId     = session.metadata?.fileId || '';  // H
        const webViewLink= '';                              // I (unknown here)
        const notes      = session.metadata?.orderNote || '';// J

        // Stripe amounts are cents
        const subtotal   = n((session.amount_subtotal ?? 0) / 100);                   // K
        const tax        = n((session.total_details?.amount_tax ?? 0) / 100);         // L
        const shipping   = n((session.total_details?.amount_shipping ?? 0) / 100);    // M
        const grandTotal = n((session.amount_total ?? 0) / 100);                      // N

        const idemKey    = session.id;                 // O
        const source     = 'QuickTees+Stripe';         // P

        const row = [
          orderId, createdAt, status, email, name, phone,
          itemsJson, fileId, webViewLink, notes,
          subtotal, tax, shipping, grandTotal,
          idemKey, source
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });

        console.log('✅ Sheet row written for paid order:', orderId);
      }
    }
  } catch (err) {
    console.error('❌ Sheet write failed:', err);
  }
  // ==== end sheet write ====
}


  return { statusCode: 200, body: 'ok' };
};
