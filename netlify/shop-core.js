// netlify/shop-core.js
// Shared logic for the Chef's Table shop functions (not a function itself).
// Used by: shop-inventory, shop-checkout, stripe-webhook, shop-admin.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SITE_URL      = 'https://chefstablefargo.com';
const TAX_PERCENT   = 7.75;               // Fargo sales tax, applied only to taxable items
const TAX_RATE_KEY  = 'ctc_fargo_7_75';   // metadata key used to find/create the Stripe tax rate
const KITCHEN_PICKUP = '670 4th Ave N, Fargo, ND (Chef\u2019s Table kitchen)';
const MIN_NOTICE_HOURS = 48;

// Orders placed on the old standalone Thanksgiving page used this Stripe price.
// Map it to the store item so those orders count toward the kit limit.
const LEGACY_PRICES = {
  'price_1UVcF0HP37wV4AxLz2wtB8B4': 'thanksgiving-2026',
};

// ---------------------------------------------------------------- Supabase
async function sb(path, method = 'GET', body = null, prefer = null) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Database is not configured.');
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
  };
  headers['Prefer'] = prefer || (method === 'GET' ? 'return=representation' : 'return=representation');
  const res  = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : [];
  if (!res.ok) {
    const msg = (data && (data.message || data.hint || data.details)) || ('HTTP ' + res.status);
    const err = new Error('Database error: ' + msg);
    err.code = data && data.code;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- Availability
// Units that count against a product's limit: paid orders that are waiting for
// pickup (pending) or already picked up (fulfilled). Cancelled and archived
// orders do not count. "Reset stock" archives fulfilled orders.
async function loadItemsWithAvailability({ includeHidden = false } = {}) {
  const filter = includeHidden ? 'active=eq.true' : 'active=eq.true&visible=eq.true';
  const items  = await sb('shop_items?' + filter + '&order=sort_order.asc,id.asc');
  const orders = await sb('shop_orders?status=in.(pending,fulfilled)&select=item_id,quantity,status');
  items.sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || (a.id - b.id));
  const now = Date.now();
  return items.map(item => {
    const mine = orders.filter(o => o.item_id === item.id);
    const pendingQty   = mine.filter(o => o.status === 'pending').reduce((s, o) => s + (o.quantity || 0), 0);
    const fulfilledQty = mine.filter(o => o.status === 'fulfilled').reduce((s, o) => s + (o.quantity || 0), 0);
    const cap = item.inventory_mode === 'max_units' ? (item.max_units || 0) : (item.current_stock || 0);
    const available = Math.max(0, cap - pendingQty - fulfilledQty);
    const deadlinePassed = !!(item.order_deadline && new Date(item.order_deadline).getTime() < now);
    let status = 'open';
    if (deadlinePassed) status = 'closed';
    else if (available <= 0) status = 'sold_out';
    return { ...item, available, pending_qty: pendingQty, fulfilled_qty: fulfilledQty, status };
  });
}

function publicItem(item) {
  return {
    id: item.id, slug: item.slug, name: item.name,
    description: item.description || '', details: item.details || '',
    icon: item.icon || '', image_url: item.image_url || '',
    price_cents: item.price_cents, taxable: item.taxable !== false,
    pickup_mode: item.pickup_mode || 'flexible',
    pickup_date: item.pickup_date || null, pickup_window: item.pickup_window || '',
    pickup_location: item.pickup_location || '',
    order_deadline: item.order_deadline || null,
    max_per_order: Math.max(1, Math.min(item.max_per_order || 10, item.available)),
    status: item.status,
    // Exact counts are not shown publicly; only a "limited" hint.
    limited: item.status === 'open' && item.available <= 10,
  };
}

// ---------------------------------------------------------------- Pickup
function formatDate(d) {
  // d: 'YYYY-MM-DD'
  const dt = new Date(d + 'T12:00:00Z');
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function eventPickupText(item) {
  const parts = [];
  if (item.pickup_date) parts.push(formatDate(item.pickup_date));
  if (item.pickup_window) parts.push(item.pickup_window);
  if (item.pickup_location) parts.push(item.pickup_location);
  return parts.join(', ');
}

// Earliest allowed date for flexible (kitchen) pickup: 48 hours out, weekdays only.
// Returns 'YYYY-MM-DD' in Central time.
function minFlexiblePickupDate(nowMs = Date.now()) {
  const d = new Date(nowMs + MIN_NOTICE_HOURS * 3600 * 1000);
  let ymd = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  for (let i = 0; i < 3; i++) {
    const dow = new Date(ymd + 'T12:00:00Z').getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    const nd = new Date(ymd + 'T12:00:00Z'); nd.setUTCDate(nd.getUTCDate() + 1);
    ymd = nd.toISOString().slice(0, 10);
  }
  return ymd;
}

// ---------------------------------------------------------------- Stripe tax rate
async function getTaxRateId(stripe) {
  const list = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = list.data.find(r => r.metadata && r.metadata.ctc_key === TAX_RATE_KEY);
  if (found) return found.id;
  const created = await stripe.taxRates.create({
    display_name: 'Sales tax',
    description:  'Fargo, ND sales tax',
    jurisdiction: 'Fargo, ND',
    percentage:   TAX_PERCENT,
    inclusive:    false,
    metadata:     { ctc_key: TAX_RATE_KEY },
  });
  return created.id;
}

// ---------------------------------------------------------------- Record a paid checkout
// Writes one shop_orders row per cart line. Safe to call more than once for the
// same session (duplicates are ignored), so the webhook and the admin "import
// from Stripe" button can both use it.
async function recordCheckoutSession(stripe, session) {
  if (!session || session.mode !== 'payment') return { recorded: 0, skipped: 'not a payment' };
  if (session.payment_status !== 'paid') return { recorded: 0, skipped: 'not paid' };

  const lines = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100, expand: ['data.price.product'],
  });

  const items = await sb('shop_items?select=*');
  const byId   = new Map(items.map(i => [String(i.id), i]));
  const bySlug = new Map(items.map(i => [i.slug, i]));

  const cd    = session.customer_details || {};
  const meta  = session.metadata || {};
  const notesField = (session.custom_fields || []).find(f => f.key === 'specialrequests');
  const notes = (notesField && notesField.text && notesField.text.value) || null;

  const rows = [];
  for (const line of lines.data) {
    const product = line.price && typeof line.price.product === 'object' ? line.price.product : null;
    const pmeta = (product && product.metadata) || {};
    let item = pmeta.item_id ? byId.get(String(pmeta.item_id)) : null;
    if (!item && line.price && LEGACY_PRICES[line.price.id]) item = bySlug.get(LEGACY_PRICES[line.price.id]);
    if (!item) continue; // not a shop product

    const isEvent = (item.pickup_mode || 'flexible') === 'event';
    const pickupDate = meta.pickup_date || (isEvent ? item.pickup_date : null) || null;
    const pickupDetails = meta.pickup_details || (isEvent ? eventPickupText(item) : KITCHEN_PICKUP);

    rows.push({
      order_ref:       session.id,
      item_id:         item.id,
      item_slug:       item.slug,
      item_name:       item.name,
      quantity:        line.quantity || 1,
      price_cents:     (line.price && line.price.unit_amount) || item.price_cents,
      subtotal_cents:  line.amount_subtotal || 0,
      tax_cents:       line.amount_tax || 0,
      total_cents:     line.amount_total || 0,
      buyer_name:      cd.name || '',
      buyer_email:     cd.email || '',
      buyer_phone:     cd.phone || null,
      pickup_date:     pickupDate,
      pickup_details:  pickupDetails,
      notes,
      payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null,
      status:          'pending',
      created_at:      new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
    });
  }

  if (!rows.length) return { recorded: 0, skipped: 'no shop items' };
  const inserted = await sb('shop_orders?on_conflict=order_ref,item_id', 'POST', rows,
    'resolution=ignore-duplicates,return=representation');
  return { recorded: Array.isArray(inserted) ? inserted.length : 0 };
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}

module.exports = {
  sb, json, SITE_URL, TAX_PERCENT, KITCHEN_PICKUP, LEGACY_PRICES,
  loadItemsWithAvailability, publicItem, eventPickupText, formatDate,
  minFlexiblePickupDate, getTaxRateId, recordCheckoutSession,
};
