// netlify/functions/shop-inventory.js
// Public product list for shop.html. Shows only visible products and never
// exposes exact stock counts or order data.

const core = require('../shop-core');

exports.handler = async () => {
  try {
    const items = await core.loadItemsWithAvailability();
    return core.json(200, {
      items: items.map(core.publicItem),
      min_pickup_date: core.minFlexiblePickupDate(),
      kitchen_pickup: core.KITCHEN_PICKUP,
      tax_percent: core.TAX_PERCENT,
    });
  } catch (err) {
    console.error('shop-inventory error:', err);
    return core.json(500, { error: 'Could not load products.' });
  }
};
