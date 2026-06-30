// netlify/functions/shop-admin.js
// Uses fetch() instead of @supabase/supabase-js — no npm deps needed

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer':        method === 'POST' ? 'return=representation' : 'return=minimal',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function sbCount(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer':        'count=exact',
      'Range':         '0-0',
    },
  });
  const range = res.headers.get('content-range') || '0/0';
  return parseInt(range.split('/')[1]) || 0;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const headers = { 'Content-Type': 'application/json' };

  try {
    const body     = JSON.parse(event.body);
    const { action, password } = body;

    // No password required

    // ── GET DASHBOARD ─────────────────────────────────────────
    if (action === 'get_dashboard') {
      const items  = await sb('shop_items?order=sort_order.asc');
      const orders = await sb('shop_orders?order=created_at.desc&limit=100');

      const itemsWithAvail = await Promise.all((items || []).map(async (item) => {
        const itemOrders = (orders || []).filter(o => o.item_id === item.id && o.status !== 'cancelled');
        const pendingQty   = itemOrders.filter(o => o.status === 'pending').reduce((s,o)=>s+(o.quantity||1),0);
        const fulfilledQty = itemOrders.filter(o => o.status === 'fulfilled').reduce((s,o)=>s+(o.quantity||1),0);
        let available;
        if (item.inventory_mode === 'max_units') {
          available = Math.max(0, (item.max_units||0) - pendingQty - fulfilledQty);
        } else {
          available = Math.max(0, (item.current_stock||0) - pendingQty);
        }
        return { ...item, available, pending_qty: pendingQty, fulfilled_qty: fulfilledQty };
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ items: itemsWithAvail, orders: orders || [] }) };
    }

    // ── SET MAX UNITS ──────────────────────────────────────────
    if (action === 'set_max_units') {
      await sb(`shop_items?id=eq.${body.item_id}`, 'PATCH', { max_units: parseInt(body.max_units), inventory_mode: 'max_units' });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── RESET STOCK ────────────────────────────────────────────
    if (action === 'reset_stock') {
      await sb(`shop_orders?item_id=eq.${body.item_id}&status=eq.fulfilled`, 'PATCH', { status: 'archived' });
      await sb(`shop_items?id=eq.${body.item_id}`, 'PATCH', {
        current_stock: parseInt(body.new_stock),
        inventory_mode: 'running_stock',
        stock_reset_at: new Date().toISOString(),
      });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── ADD STOCK ──────────────────────────────────────────────
    if (action === 'add_stock') {
      const items = await sb(`shop_items?id=eq.${body.item_id}`);
      const current = items[0]?.current_stock || 0;
      const newStock = current + parseInt(body.add_qty);
      await sb(`shop_items?id=eq.${body.item_id}`, 'PATCH', { current_stock: newStock });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, new_stock: newStock }) };
    }

    // ── FULFILL ORDER ──────────────────────────────────────────
    if (action === 'fulfill_order') {
      await sb(`shop_orders?id=eq.${body.order_id}`, 'PATCH', { status: 'fulfilled', fulfilled_at: new Date().toISOString() });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── CANCEL ORDER ───────────────────────────────────────────
    if (action === 'cancel_order') {
      await sb(`shop_orders?id=eq.${body.order_id}`, 'PATCH', { status: 'cancelled' });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── TOGGLE VISIBILITY ──────────────────────────────────────
    if (action === 'toggle_visibility') {
      await sb(`shop_items?id=eq.${body.item_id}`, 'PATCH', { visible: body.visible });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── ADD ITEM ───────────────────────────────────────────────
    if (action === 'add_item') {
      const { name, slug, description, price_cents, inventory_mode, max_units, current_stock, sort_order, visible } = body;
      if (!name || !slug || !price_cents) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, slug, and price required.' }) };
      }
      const result = await sb('shop_items', 'POST', {
        name, slug, description, price_cents,
        inventory_mode: inventory_mode || 'running_stock',
        max_units: max_units || 0,
        current_stock: current_stock || 0,
        sort_order: sort_order || 10,
        visible: visible !== false,
        active: true,
        created_at: new Date().toISOString(),
      });
      if (result?.code === '23505') {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'A product with that slug already exists.' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── EDIT ITEM ──────────────────────────────────────────────
    if (action === 'edit_item') {
      const { item_id, name, slug, description, price_cents, inventory_mode, max_units, current_stock, sort_order } = body;
      await sb(`shop_items?id=eq.${item_id}`, 'PATCH', {
        name, slug, description, price_cents, inventory_mode, max_units, current_stock, sort_order,
      });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action.' }) };

  } catch (err) {
    console.error('Admin error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
