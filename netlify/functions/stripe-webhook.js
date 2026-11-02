// netlify/functions/stripe-webhook.js
// Stripe calls this when a checkout is paid; the order is saved to the shop database.
// Needs STRIPE_WEBHOOK_SECRET (from the webhook endpoint in the Stripe dashboard).

const Stripe = require('stripe');
const core = require('../shop-core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return { statusCode: 500, body: 'Webhook not configured' };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : (event.body || '');

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error('Webhook signature check failed:', err.message);
    return { statusCode: 400, body: 'Invalid signature' };
  }

  try {
    if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
      // Re-read the session from Stripe so its shape matches this code's API version,
      // whatever API version the webhook destination is set to.
      const session = await stripe.checkout.sessions.retrieve(evt.data.object.id);
      const result = await core.recordCheckoutSession(stripe, session);
      console.log('Recorded', session.id, JSON.stringify(result));
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    // A non-200 makes Stripe retry later, so a database hiccup does not lose the order.
    console.error('Webhook processing error:', err);
    return { statusCode: 500, body: 'Error recording order' };
  }
};
