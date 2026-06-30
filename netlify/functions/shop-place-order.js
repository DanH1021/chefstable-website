// Uses fetch() — no npm deps
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
const TAX_RATE     = 0.0775;

async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const headers = { 'Content-Type': 'application/json' };

  try {
    const { payment_intent_id, item_id, item_slug, quantity,
            buyer_name, buyer_email, buyer_phone, pickup_date, notes } = JSON.parse(event.body);

    // Verify payment with Stripe
    const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${payment_intent_id}`, {
      headers: { 'Authorization': 'Basic ' + Buffer.from(STRIPE_KEY + ':').toString('base64') }
    });
    const intent = await stripeRes.json();
    if (intent.status !== 'succeeded') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment not confirmed.' }) };
    }

    const items = await sb(`shop_items?id=eq.${item_id}`);
    const item  = items[0];
    if (!item) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Item not found.' }) };

    const subtotal    = item.price_cents * quantity;
    const tax_cents   = Math.round(subtotal * TAX_RATE);
    const total_cents = subtotal + tax_cents;

    await sb('shop_orders', 'POST', {
      item_id, item_slug, item_name: item.name, quantity,
      price_cents: item.price_cents,
      subtotal_cents: subtotal,
      tax_cents,
      total_cents,
      buyer_name, buyer_email, buyer_phone, pickup_date, notes,
      payment_intent_id,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
