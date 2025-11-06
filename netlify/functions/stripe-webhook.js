// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30' });

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
    // You can later write this to a Sheet/DB. For now we just log it:
    console.log('PAID:', {
      sessionId: session.id,
      email: session.customer_details?.email || session.customer_email || '',
      metadata: session.metadata || {},
      amount_total: session.amount_total,
      currency: session.currency
    });
  }

  return { statusCode: 200, body: 'ok' };
};
