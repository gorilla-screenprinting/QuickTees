// netlify/functions/create-checkout.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const { google } = require('googleapis');
const { GARMENT_PRICE_IDS, DTF_PRICE_IDS } = require('./config/prices.js');
const SHIPPING_TABLE = require('./config/shipping.json');

// ---- helpers ----

// accept filename like "Heavy_White_Cotton_T.png" and map to SKU
const FILENAME_TO_SKU = {
  heavy_white_cotton_t: 'tee-heavy-white',
  heavy_black_cotton_t: 'tee-heavy-black',
  light_white_cotton_t: 'tee-light-white',
  light_black_cotton_t: 'tee-light-black',
  // Current manifest filenames
  white_t_front: 'tee-heavy-white',
  white_t_back: 'tee-heavy-white',
  black_t_front: 'tee-heavy-black',
  black_t_back: 'tee-heavy-black',
  p_white_t_front: 'tee-heavy-white',
  p_white_t_back: 'tee-heavy-white',
  p_black_t_front: 'tee-heavy-black',
  p_black_t_back: 'tee-heavy-black',
};
function toSku(id) {
  if (!id) return '';
  const k = String(id).toLowerCase().replace(/\.[^.]+$/, ''); // strip ".png"
  return FILENAME_TO_SKU[k] || id;
}

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

  // Legacy/array path: preserve behavior
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
      note: body.orderNote || '',
      sides: body.sides || null                      // optional { front:{...}, back:{...} }
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

    // Placements: support multi-side under one garment
    const placements = [];
    if (it.sides && typeof it.sides === 'object') {
      ['front', 'back'].forEach(side => {
        const s = it.sides[side];
        if (s && (s.fileId || s.tierIn || s.readoutIn)) {
          placements.push({ ...s, placement: side });
        }
      });
    }
    if (!placements.length && (it.fileId || it.placement)) {
      placements.push({
        placement: it.placement || 'front',
        fileId: it.fileId || '',
        tierIn: it.tierIn || null,
        readoutIn: it.readoutIn || null
      });
    }

    if (!placements.length) {
      const e = new Error('No art placements provided.');
      e.statusCode = 400; throw e;
    }

    for (const p of placements) {
      // Tier: explicit tierIn, else derive from readoutIn
      let tier = Number(p.tierIn);
      const readout = p.readoutIn || it.readoutIn;
      if (!Number.isFinite(tier) && readout) {
        const w = Number(readout.w_in) || 0;
        const h = Number(readout.h_in) || 0;
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

      const dtfSku = decorationSkuFromTierAndPlacement(tier, p.placement);
      const dtfPriceId = dtfSku ? DTF_PRICE_IDS[dtfSku] : null;
      if (!dtfPriceId) {
        const e = new Error(`Unknown decoration SKU: ${dtfSku}`);
        e.statusCode = 400; throw e;
      }
      line_items.push({ price: dtfPriceId, quantity: qty });
    }
  }

  return { line_items, totalCount, items };
}

// Build a compact, metadata-safe snapshot (Stripe limits metadata values to 500 chars)
function compactItemsForMetadata(items = []) {
  try {
    const compact = items.map(it => {
      const sides = it.sides || {};
      return {
        g: it.garmentSKU || '',
        s: Object.keys(it.sizeRun || {}),
        f: it.fileId || sides.front?.fileId || '',
        b: sides.back?.fileId || '',
        tf: sides.front?.tierIn ?? it.tierIn ?? null,
        tb: sides.back?.tierIn ?? null
      };
    });
    let str = JSON.stringify(compact);
    if (str.length > 480) str = str.slice(0, 477) + '...'; // stay under 500 char limit
    return str;
  } catch (e) {
    console.error('compactItemsForMetadata failed:', e.message);
    return '';
  }
}

async function getDriveFileName(fileId) {
  if (!fileId) return '';
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GDRIVE_SERVICE_KEY),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });
    const { data } = await drive.files.get({
      fileId,
      fields: 'name',
      supportsAllDrives: true,   // <-- add this
    });
    return data?.name || '';
  } catch (e) {
    console.error('drive filename lookup failed:', e.message);
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  if (!body.designLabel && body.fileId) {
    const nm = await getDriveFileName(body.fileId);
    if (nm) body.designLabel = String(nm).replace(/\.[^.]+$/, '');
  }
  body.garmentSKU = body.garmentSKU || toSku(body.productId);


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
      items: compactItemsForMetadata(items)
      },

      allow_promotion_codes: true
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    const status = err.statusCode || 500;
    const msg = err.message || 'Checkout session error';
    console.error('Checkout error:', err);
    return { statusCode: status, body: msg };
  }
};
