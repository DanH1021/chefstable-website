// netlify/functions/shop-admin.js
// Admin API for shop-admin.html. Every request must include the admin password,
// which is checked against the SHOP_ADMIN_PASSWORD environment variable.

const crypto = require('crypto');
const Stripe = require('stripe');
const core = require('../shop-core');

const ITEM_FIELDS = {
  name: 'text', slug: 'slug', description: 'text', details: 'text', icon: 'text', image_url: 'text',
  price_cents: 'int', taxable: 'bool', inventory_mode: 'mode', max_units: 'int', current_stock: 'int',
  max_per_order: 'int', sort_order: 'int', visible: 'bool',
  pickup_mode: 'pickup', pickup_date: 'date', pickup_window: 'text', pickup_location: 'text',
  order_deadline: 'datetime',
};

function passwordOk(given) {
  const real = process.env.SHOP_ADMIN_PASSWORD || '';
  if (!real || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

function cleanItem(input, { partial }) {
  const out = {};
  for (const [key, type] of Object.entries(ITEM_FIELDS)) {
    if (!(key in input)) continue;
    let v = input[key];
    if (v === '' || v === undefined) v = null;
    switch (type) {
      case 'text': out[key] = v === null ? null : String(v).slice(0, 4000); break;
      case 'slug':
        if (!v || !/^[a-z0-9-]{2,60}$/.test(v)) throw new Error('URL slug must be lowercase letters, numbers and hyphens.');
        out[key] = v; break;
      case 'int': {
        if (v === null) { out[key] = key === 'price_cents' ? null : 0; break; }
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error('Invalid number for ' + key + '.');
        out[key] = n; break;
      }
      case 'bool': out[key] = v === true || v === 'true'; break;
      case 'mode':
        if (!['max_units', 'running_stock'].includes(v)) throw new Error('Invalid inventory mode.');
        out[key] = v; break;
      case 'pickup':
        if (!['flexible', 'event'].includes(v)) throw new Error('Invalid pickup type.');
        out[key] = v; break;
      case 'date':
        if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Invalid pickup date.');
        out[key] = v; break;
      case 'datetime':
        if (v !== null && isNaN(new Date(v).getTime())) throw new Error('Invalid order deadline.');
        out[key] = v === null ? null : new Date(v).toISOString(); break;
    }
  }
  if (!partial) {
    if (!out.name) throw new Error('Product name is required.');
    if (!out.slug) throw new Error('URL slug is required.');
    if (!out.price_cents) throw new Error('Price is required.');
  }
  if ('price_cents' in out && !out.price_cents) throw new Error('Price is required.');
  return out;
}

function id(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid id.');
  return n;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return core.json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return core.json(400, { error: 'Invalid request.' }); }

  if (!process.env.SHOP_ADMIN_PASSWORD) {
    return core.json(503, { error: 'Admin password has not been set up yet (SHOP_ADMIN_PASSWORD in Netlify).' });
  }
  if (!passwordOk(body.password)) {
    await new Promise(r => setTimeout(r, 800));
    return core.json(401, { error: 'Incorrect password.' });
  }

  const { action } = body;
  try {
    if (action === 'login') return core.json(200, { success: true });

    if (action === 'get_dashboard') {
      const items  = await core.loadItemsWithAvailability({ includeHidden: true });
      const orders = await core.sb('shop_orders?order=created_at.desc&limit=2000');
      return core.json(200, { items, orders });
    }

    if (action === 'add_item') {
      const row = cleanItem(body.item || {}, { partial: false });
      row.active = true;
      try {
        await core.sb('shop_items', 'POST', row);
      } catch (e) {
        if (e.code === '23505') return core.json(409, { error: 'A product with that URL slug already exists.' });
        throw e;
      }
      return core.json(200, { success: true });
    }

    if (action === 'update_item') {
      const row = cleanItem(body.item || {}, { partial: true });
      try {
        await core.sb('shop_items?id=eq.' + id(body.item_id), 'PATCH', row);
      } catch (e) {
        if (e.code === '23505') return core.json(409, { error: 'A product with that URL slug already exists.' });
        throw e;
      }
      return core.json(200, { success: true });
    }

    if (action === 'duplicate_item') {
      const src = (await core.sb('shop_items?id=eq.' + id(body.item_id)))[0];
      if (!src) return core.json(404, { error: 'Product not found.' });
      const copy = { ...src };
      delete copy.id; delete copy.created_at; delete copy.stock_reset_at;
      copy.slug = cleanItem({ slug: body.new_slug }, { partial: true }).slug;
      copy.name = String(body.new_name || src.name).slice(0, 200);
      copy.visible = false;
      try {
        await core.sb('shop_items', 'POST', copy);
      } catch (e) {
        if (e.code === '23505') return core.json(409, { error: 'A product with that URL slug already exists.' });
        throw e;
      }
      return core.json(200, { success: true });
    }

    if (action === 'archive_item') {
      await core.sb('shop_items?id=eq.' + id(body.item_id), 'PATCH', { active: false, visible: false });
      return core.json(200, { success: true });
    }

    if (action === 'add_stock') {
      const item = (await core.sb('shop_items?id=eq.' + id(body.item_id)))[0];
      if (!item) return core.json(404, { error: 'Product not found.' });
      const add = parseInt(body.add_qty, 10);
      if (!Number.isFinite(add)) return core.json(400, { error: 'Invalid quantity.' });
      await core.sb('shop_items?id=eq.' + item.id, 'PATCH', { current_stock: Math.max(0, (item.current_stock || 0) + add) });
      return core.json(200, { success: true });
    }

    if (action === 'reset_stock') {
      const itemId = id(body.item_id);
      const n = parseInt(body.new_stock, 10);
      if (!Number.isFinite(n) || n < 0) return core.json(400, { error: 'Invalid stock level.' });
      await core.sb('shop_orders?item_id=eq.' + itemId + '&status=eq.fulfilled', 'PATCH', { status: 'archived' });
      await core.sb('shop_items?id=eq.' + itemId, 'PATCH', { current_stock: n, stock_reset_at: new Date().toISOString() });
      return core.json(200, { success: true });
    }

    if (action === 'set_order_status') {
      const status = body.status;
      if (!['pending', 'fulfilled', 'cancelled'].includes(status)) return core.json(400, { error: 'Invalid status.' });
      const patch = { status, fulfilled_at: status === 'fulfilled' ? new Date().toISOString() : null };
      if (body.order_ref) {
        const ref = String(body.order_ref);
        if (!/^[A-Za-z0-9_]+$/.test(ref)) return core.json(400, { error: 'Invalid order.' });
        await core.sb('shop_orders?order_ref=eq.' + ref + '&status=neq.archived', 'PATCH', patch);
      } else {
        await core.sb('shop_orders?id=eq.' + id(body.order_id), 'PATCH', patch);
      }
      return core.json(200, { success: true });
    }

    if (action === 'test_alert') {
      // Sends a sample order alert so the email setup can be checked.
      if (!core.alertConfigured()) {
        return core.json(400, { error: 'Email is not set up yet: add SMTP_USER and SMTP_PASS in Netlify, then redeploy.' });
      }
      const sample = [{
        buyer_name: 'Test Customer', buyer_email: 'test@example.com', buyer_phone: '+1 701-555-0100',
        item_name: 'Thanksgiving Meal Kit', quantity: 2, total_cents: 18000,
        notes: 'This is a test. One kit without stuffing, please.',
        pickup_details: 'Wednesday, November 25, 4:00 PM to 6:00 PM, Drekker Brewhalla',
      }];
      try {
        const r = await core.sendOrderAlert(sample, { test: true });
        return core.json(200, { success: true, to: r.to });
      } catch (e) {
        return core.json(400, { error: 'Email failed: ' + e.message });
      }
    }

    if (action === 'import_stripe') {
      // Pulls paid Stripe checkouts from the last N days into the order list.
      // Already-saved orders are skipped, so this is safe to run any time.
      const days = Math.min(Math.max(parseInt(body.days, 10) || 60, 1), 365);
      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      let checked = 0, recorded = 0;
      for await (const s of stripe.checkout.sessions.list({ created: { gte: since }, status: 'complete', limit: 100 })) {
        checked++;
        if (s.payment_status !== 'paid') continue;
        const r = await core.recordCheckoutSession(stripe, s);
        recorded += r.recorded || 0;
        if (checked >= 1000) break;
      }
      return core.json(200, { success: true, checked, recorded });
    }

    return core.json(400, { error: 'Unknown action.' });
  } catch (err) {
    console.error('shop-admin error:', err);
    return core.json(400, { error: err.message || 'Server error.' });
  }
};
