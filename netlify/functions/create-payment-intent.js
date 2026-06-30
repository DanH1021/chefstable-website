// Uses fetch() — no npm deps
const TAX_RATE = 0.0775;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { amount, item_id } = JSON.parse(event.body);
    if (!amount || typeof amount !== 'number' || amount < 100 || amount > 100000) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount.' }) };
    }

    const taxAmount   = Math.round(amount * TAX_RATE);
    const totalAmount = amount + taxAmount;

    const params = new URLSearchParams({
      amount:   totalAmount,
      currency: 'usd',
      'metadata[source]':   "Chef's Table Catering Shop",
      'metadata[subtotal]': String(amount),
      'metadata[tax]':      String(taxAmount),
      'metadata[tax_rate]': '7.75%',
      'metadata[item_id]':  String(item_id || ''),
    });

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64'),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const intent = await res.json();
    if (intent.error) throw new Error(intent.error.message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientSecret: intent.client_secret,
        subtotal:     amount,
        tax:          taxAmount,
        total:        totalAmount,
      })
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
