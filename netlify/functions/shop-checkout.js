// netlify/functions/shop-checkout.js
// Builds a Stripe Checkout Session from the shopper's cart.
// Prices, limits, deadlines and tax come from the database, never from the browser.

const Stripe = require('stripe');
const core = require('../shop-core');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return core.json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return core.json(400, { error: 'Invalid request.' }); }

  const cart = Array.isArray(body.items) ? body.items : [];
  if (!cart.length) return core.json(400, { error: 'Your order is empty.' });
  if (cart.length > 20) return core.json(400, { error: 'Too many items.' });

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const items  = await core.loadItemsWithAvailability();
    const bySlug = new Map(items.map(i => [i.slug, i]));

    // Merge duplicate lines and validate each one.
    const wanted = new Map();
    for (const line of cart) {
      const slug = String(line.slug || '');
      const qty  = parseInt(line.qty, 10);
      if (!bySlug.has(slug)) return core.json(400, { error: 'One of the items in your order is no longer available.' });
      if (!qty || qty < 1) return core.json(400, { error: 'Invalid quantity.' });
      wanted.set(slug, (wanted.get(slug) || 0) + qty);
    }

    const chosen = [];
    for (const [slug, qty] of wanted) {
      const item = bySlug.get(slug);
      if (item.status === 'closed')   return core.json(409, { error: item.name + ': ordering has closed.' });
      if (item.status === 'sold_out') return core.json(409, { error: item.name + ' is sold out.' });
      const perOrder = item.max_per_order || 10;
      if (qty > perOrder) return core.json(409, { error: item.name + ': limit ' + perOrder + ' per order.' });
      if (qty > item.available) {
        return core.json(409, { error: 'Sorry, there are not enough ' + item.name + ' left for that quantity. Please lower the quantity.' });
      }
      chosen.push({ item, qty });
    }

    // Pickup: an event item (e.g. a holiday kit) sets pickup for the whole order.
    const eventItems = chosen.filter(c => (c.item.pickup_mode || 'flexible') === 'event');
    const eventKeys = new Set(eventItems.map(c => core.eventPickupText(c.item)));
    if (eventKeys.size > 1) {
      return core.json(400, { error: 'These items have different pickup days. Please place a separate order for each.' });
    }

    let pickupDate, pickupDetails;
    if (eventItems.length) {
      pickupDate    = eventItems[0].item.pickup_date || '';
      pickupDetails = core.eventPickupText(eventItems[0].item);
    } else {
      pickupDate = String(body.pickup_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return core.json(400, { error: 'Please choose a pickup date.' });
      const dow = new Date(pickupDate + 'T12:00:00Z').getUTCDay();
      if (dow === 0 || dow === 6) return core.json(400, { error: 'Pickup is weekdays only. Please choose a weekday.' });
      if (pickupDate < core.minFlexiblePickupDate()) {
        return core.json(400, { error: 'Please allow at least 48 hours notice. Earliest pickup: ' + core.formatDate(core.minFlexiblePickupDate()) + '.' });
      }
      pickupDetails = core.formatDate(pickupDate) + ', ' + core.KITCHEN_PICKUP;
    }

    const needsTax = chosen.some(c => c.item.taxable !== false);
    const taxRateId = needsTax ? await core.getTaxRateId(stripe) : null;

    const line_items = chosen.map(({ item, qty }) => {
      const li = {
        quantity: qty,
        price_data: {
          currency: 'usd',
          unit_amount: item.price_cents,
          product_data: {
            name: item.name,
            metadata: { item_id: String(item.id), slug: item.slug },
          },
        },
      };
      if (item.description) li.price_data.product_data.description = item.description.slice(0, 500);
      if (item.taxable !== false) li.tax_rates = [taxRateId];
      return li;
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      phone_number_collection: { enabled: true },
      billing_address_collection: 'auto',
      custom_fields: [{
        key: 'specialrequests',
        label: { type: 'custom', custom: 'Special requests (optional)' },
        type: 'text',
        optional: true,
        text: { maximum_length: 255 },
      }],
      custom_text: {
        submit: { message: 'Pickup: ' + pickupDetails },
      },
      metadata: {
        source: 'ctc-shop',
        pickup_date: pickupDate,
        pickup_details: pickupDetails.slice(0, 480),
      },
      payment_intent_data: {
        description: "Chef's Table order: " + chosen.map(c => c.qty + ' x ' + c.item.name).join(', ').slice(0, 400),
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: core.SITE_URL + '/shop.html?order=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  core.SITE_URL + '/shop.html',
    });

    return core.json(200, { url: session.url });
  } catch (err) {
    console.error('shop-checkout error:', err);
    return core.json(500, { error: 'Could not start checkout. Please try again or call 701-566-3473.' });
  }
};
