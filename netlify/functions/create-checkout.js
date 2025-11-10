// netlify/functions/create-checkout.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const { GARMENT_PRICE_IDS, DTF_PRICE_IDS } = require('./config/prices.js');
const SHIPPING_TABLE = require('./config/shipping.json');

// ---- helpers ----
function sumSizeRun(sizeRun = {}) {
  return Object.values(sizeRun).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

function pickShippingCentsByCount(count) {
  if (!SHIPPING_TABLE || SHIPPING_TABLE.model !== 'count') return 0;
  if (count >= 36) {
    const err = new Error('Quantity too high for DTF. Please contact us for screenprinting.');
    err.statusCode = 400;
    throw err;
  }
  const bracket = (SHIPPING_TABLE.brackets || []).find(b => count >= b.min && count <= b.max);
  return bracket ? (bracket.amount_cents | 0) : 0;
}

function decorationSkuFromTierAndPlacement(tierIn, placement /* 'front'|'back' */) {
  const t = Number(tierIn);
  if (![4, 8, 12, 16].includes(t)) return null;
  const p = (placement || 'front').toLowerCase() === 'back' ? 'back' : 'front';
  return `dtf-${t}-${p}`; // e.g., dtf-12-front
}

// Build line items (supports new items[] or legacy single item body)
function buildLineItemsFromBody(body = {}) {
  const line_items = [];
  let totalCount = 0;

  const items = Array.isArray(body.items) && body.items.length
    ? body.items
    : [{
        designLabel: body.designLabel || 'Design',
        garmentSKU: body.garmentSKU || body.productId, // legacy support
        placement: (body.placement || 'front'),
        sizeRun: body.sizeRun || { L: 1 },             // minimal default
        readoutIn: body.readoutIn || null,
        tierIn: body.tierIn || null,
        fileId: body.fileId || '',
        note: body.orderNote || ''
      }];

  for (const it of items) {
    const qty = Math.max(0, sumSizeRun(it.sizeRun));
    if (!qty) continue;
    totalCount += qty;

    // Garment line
    const garmentPriceId = GARMENT_PRICE_IDS[it.garmentSKU];
    if (!garmentPriceId) {
      const e = new Error(`Unknown garment SKU: ${it.garmentSKU}`);
      e.statusCode = 400; throw e;
    }
    line_items.push({ price: garmentPriceId, quantity: qty });

    // Tier: explicit tierIn, else derive from readoutIn
    let tier = Number(it.tierIn);
    if (!Number.isFinite(tier) && it.readoutIn) {
      const w = Number(it.readoutIn.w_in) || 0;
      const h = Number(it.readoutIn.h_in) || 0;
      const maxIn = Math.max(w, h);
      if (maxIn <= 4) tier = 4;
      else if (maxIn <= 8) tier = 8;
      else if (maxIn <= 12) tier = 12;
      else if (maxIn <= 16) tier = 16;
      else {
        const e = new Error('Artwork exceeds 16" — too large for DTF.');
        e.statusCode = 400; throw e;
      }
    }
    if (!Number.isFinite(tier)) tier = 8; // safe default

    // Decoration line
    const dtfSku = decorationSkuFromTierAndPlacement(tier, it.placement);
    const dtfPriceId = dtfSku ? DTF_PRICE_IDS[dtfSku] : null;
    if (!dtfPriceId) {
      const e = new Error(`Unknown decoration SKU: ${dtfSku}`);
      e.statusCode = 400; throw e;
    }
    line_items.push({ price: dtfPriceId, quantity: qty });
  }

  return { line_items, totalCount, items };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  try {
    // Build items and shipping
    const { line_items, totalCount, items } = buildLineItemsFromBody(body);

    if (!line_items.length) {
      return { statusCode: 400, body: 'No valid items in request.' };
    }

    let shippingAmountCents = 0;
    try {
      shippingAmountCents = pickShippingCentsByCount(totalCount);
    } catch (e) {
      const status = e.statusCode || 400;
      return { statusCode: status, body: e.message || 'Invalid order' };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,

      // Stripe Tax
      automatic_tax: { enabled: true },

      // Shipping: US only, single fixed UPS Ground option from table
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: 'UPS Ground',
            type: 'fixed_amount',
            fixed_amount: { amount: shippingAmountCents, currency: 'usd' },
            tax_behavior: 'exclusive'
          }
        }
      ],

      customer_email: body.email || undefined,
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/?canceled=1`,

      // Audit metadata
      metadata: {
        fileId: body.fileId || '',
        orderNote: body.orderNote || '',
        customerName: body.customerName || '',
        customerPhone: body.customerPhone || '',
        items: JSON.stringify(items.map(it => ({
          designLabel: it.designLabel || '',
          fileId: it.fileId || '',
          garmentSKU: it.garmentSKU || '',
          placement: (it.placement || 'front'),
          sizeRun: it.sizeRun || {},
          tierIn: it.tierIn || null,
          readoutIn: it.readoutIn || null
        })))
      },

      allow_promotion_codes: true
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error('Checkout error:', err);
    return { statusCode: 500, body: 'Checkout session error' };
  }
};
