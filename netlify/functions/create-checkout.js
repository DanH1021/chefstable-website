// netlify/functions/create-checkout.js
// Creates a Stripe Checkout Session server-side and returns the URL.
// Requires STRIPE_SECRET_KEY environment variable set in Netlify dashboard.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_ID    = 'price_1UVcF0HP37wV4AxLz2wtB8B4';
const SUCCESS_URL = 'https://chefstablefargo.com/order-success.html?session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL  = 'https://chefstablefargo.com/thanksgiving-kit.html';
const MAX_QTY     = 10;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let qty;
  try {
    const body = JSON.parse(event.body || '{}');
    qty = parseInt(body.quantity, 10);
    if (!qty || qty < 1 || qty > MAX_QTY) throw new Error('Invalid quantity');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid quantity' }) };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: PRICE_ID, quantity: qty }],
      success_url: SUCCESS_URL,
      cancel_url:  CANCEL_URL,
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: true },
      // No tax — heat-and-serve prepared foods are exempt in ND
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
