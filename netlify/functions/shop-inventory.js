// Uses fetch() — no npm deps
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
  });
  return res.json();
}

exports.handler = async function () {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const items  = await sb('shop_items?active=eq.true&order=sort_order.asc');
    const orders = await sb('shop_orders?status=eq.pending&select=item_id,quantity');

    const results = (items || []).map(item => {
      let available = 0;
      if (item.inventory_mode === 'max_units') {
        const allOrders = (orders || []).filter(o => o.item_id === item.id);
        const totalOrdered = allOrders.reduce((s,o)=>s+(o.quantity||1),0);
        available = Math.max(0, (item.max_units||0) - totalOrdered);
      } else {
        const pending = (orders || []).filter(o => o.item_id === item.id);
        const pendingQty = pending.reduce((s,o)=>s+(o.quantity||1),0);
        available = Math.max(0, (item.current_stock||0) - pendingQty);
      }
      return {
        id: item.id, slug: item.slug, name: item.name,
        description: item.description, price_cents: item.price_cents,
        inventory_mode: item.inventory_mode,
        available, sold_out: available === 0, visible: item.visible,
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ items: results }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
