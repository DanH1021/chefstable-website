-- ============================================================
-- CHEF'S TABLE SHOP - November 2026 update
-- Adds cart checkout, per-product tax, pickup settings, order
-- deadlines, and the Thanksgiving Meal Kit.
-- Paste into Supabase > SQL Editor and click Run. Safe to run twice.
-- ============================================================

-- Product settings
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS taxable         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS pickup_mode     TEXT    NOT NULL DEFAULT 'flexible';
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS pickup_date     DATE;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS pickup_window   TEXT;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS pickup_location TEXT;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS order_deadline  TIMESTAMPTZ;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS max_per_order   INT NOT NULL DEFAULT 10;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS details         TEXT;   -- "what's included", one per line
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS icon            TEXT;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS image_url       TEXT;

ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_pickup_mode_check;
ALTER TABLE shop_items ADD CONSTRAINT shop_items_pickup_mode_check CHECK (pickup_mode IN ('flexible', 'event'));

-- Orders: one Stripe checkout can now hold several products (one row each)
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS order_ref      TEXT;   -- Stripe Checkout Session id
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS pickup_details TEXT;
ALTER TABLE shop_orders DROP CONSTRAINT IF EXISTS shop_orders_payment_intent_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_ref_item_uidx ON shop_orders(order_ref, item_id);
CREATE INDEX IF NOT EXISTS shop_orders_order_ref_idx ON shop_orders(order_ref);

-- Existing products
UPDATE shop_items SET taxable = true,  pickup_mode = 'flexible', max_per_order = 20, icon = chr(129362)
  WHERE slug = 'pickles';
UPDATE shop_items SET taxable = false, pickup_mode = 'event', icon = chr(128035)
  WHERE slug = 'easter';

-- Thanksgiving Meal Kit (no sales tax: heat-and-serve prepared food)
INSERT INTO shop_items (
  slug, name, description, details, icon, price_cents, taxable,
  inventory_mode, max_units, current_stock, max_per_order,
  pickup_mode, pickup_date, pickup_window, pickup_location, order_deadline,
  visible, active, sort_order
) VALUES (
  'thanksgiving-2026',
  'Thanksgiving Meal Kit',
  'A complete, fully cooked Thanksgiving dinner in heat-and-serve containers, with heating instructions. Feeds 4 to 6 adults.',
  'Two pounds of cooked and sliced turkey breast and thigh meat' || chr(10) ||
  'One quart of garlic whipped potatoes' || chr(10) ||
  'One quart of turkey gravy' || chr(10) ||
  'One quart of stuffing' || chr(10) ||
  'One quart of green bean casserole (crispy onions packaged separately)' || chr(10) ||
  'One dozen King''s Hawaiian dinner rolls',
  chr(129411),
  9000, false,
  'max_units', 120, 0, 10,
  'event', '2026-11-25', '4:00 PM to 6:00 PM',
  'Drekker Brewhalla, 1702 1st Ave N, Fargo (marketplace near the main entrance)',
  '2026-11-24 23:59:59-06',
  true, true, 0
)
ON CONFLICT (slug) DO NOTHING;
