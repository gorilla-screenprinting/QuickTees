// netlify/functions/get-prices.js
// Returns current price amounts for garments and DTF tiers from Stripe (single source of truth).

const Stripe = require('stripe');
const { GARMENT_PRICE_IDS, DTF_PRICE_IDS } = require('./config/prices.js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function fetchPriceAmounts(map) {
  const entries = Object.entries(map || {});
  const results = await Promise.all(entries.map(async ([key, priceId]) => {
    const price = await stripe.prices.retrieve(priceId);
    return [key, { priceId, unit_amount: price.unit_amount, currency: price.currency }];
  }));
  return Object.fromEntries(results);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const [garments, dtf] = await Promise.all([
      fetchPriceAmounts(GARMENT_PRICE_IDS),
      fetchPriceAmounts(DTF_PRICE_IDS)
    ]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ garments, dtf })
    };
  } catch (err) {
    console.error('get-prices error:', err);
    return { statusCode: 500, body: 'Failed to fetch prices' };
  }
};
