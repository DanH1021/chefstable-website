-- ============================================================
-- CHEF'S TABLE SHOP — Supabase Setup
-- Run this in your Supabase SQL editor
-- Project: shaqvvvuqxgtkldnzpoh.supabase.co
-- ============================================================

-- SHOP ITEMS
-- One row per product. Supports both inventory modes.
CREATE TABLE IF NOT EXISTS shop_items (
  id              BIGSERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,        -- e.g. 'pickles', 'easter'
  name            TEXT NOT NULL,
  description     TEXT,
  price_cents     INT NOT NULL,                -- price in cents (e.g. 1200 = $12.00)
  inventory_mode  TEXT NOT NULL DEFAULT 'running_stock'
                  CHECK (inventory_mode IN ('max_units', 'running_stock')),
  max_units       INT DEFAULT 0,               -- used in max_units mode: total cap
  current_stock   INT DEFAULT 0,               -- used in running_stock mode: current on-hand
  stock_reset_at  TIMESTAMPTZ,                 -- timestamp of last stock reset
  visible         BOOLEAN DEFAULT true,        -- controls front-end visibility
  active          BOOLEAN DEFAULT true,        -- soft delete
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- SHOP ORDERS
-- One row per order placed through the website
CREATE TABLE IF NOT EXISTS shop_orders (
  id                  BIGSERIAL PRIMARY KEY,
  item_id             BIGINT REFERENCES shop_items(id),
  item_slug           TEXT,
  item_name           TEXT,
  quantity            INT NOT NULL DEFAULT 1,
  price_cents         INT NOT NULL,            -- per-unit price at time of order
  subtotal_cents      INT NOT NULL,
  tax_cents           INT NOT NULL DEFAULT 0,
  total_cents         INT NOT NULL,
  buyer_name          TEXT NOT NULL,
  buyer_email         TEXT NOT NULL,
  buyer_phone         TEXT,
  pickup_date         DATE,
  notes               TEXT,
  payment_intent_id   TEXT UNIQUE,             -- Stripe PaymentIntent ID
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'fulfilled', 'cancelled', 'archived')),
  fulfilled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- SEED INITIAL ITEMS
-- Adjust prices, modes, and stock levels as needed before going live
INSERT INTO shop_items (slug, name, description, price_cents, inventory_mode, max_units, current_stock, visible, sort_order)
VALUES
  (
    'easter',
    'Easter Brunch Meal Kit',
    'Everything you need for a spectacular Easter brunch at home. Feeds a family of 4–6. Available for pickup only.',
    8500,           -- $85.00
    'max_units',    -- Cap mode: once 100 are sold, it''s gone
    100,            -- Max 100 kits
    0,              -- current_stock not used in max_units mode
    false,          -- hidden until Easter season
    1
  ),
  (
    'pickles',
    'House-Made Pickles — Quart Jar',
    'Chef''s Table''s signature house-made pickled vegetables. Available for pickup at our kitchen.',
    1200,           -- $12.00
    'running_stock', -- Stock mode: tracks on-hand inventory
    0,              -- max_units not used in running_stock mode
    24,             -- start with 24 jars in stock
    true,           -- visible immediately
    2
  )
ON CONFLICT (slug) DO NOTHING;

-- INDEXES for performance
CREATE INDEX IF NOT EXISTS shop_orders_item_id_idx    ON shop_orders(item_id);
CREATE INDEX IF NOT EXISTS shop_orders_status_idx     ON shop_orders(status);
CREATE INDEX IF NOT EXISTS shop_orders_created_at_idx ON shop_orders(created_at DESC);

-- ROW LEVEL SECURITY
-- Orders table: insert allowed (for placing orders), select blocked from frontend
ALTER TABLE shop_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;

-- Shop items: anyone can read active+visible items (for the store page)
CREATE POLICY "Public can read visible shop items"
  ON shop_items FOR SELECT
  USING (active = true AND visible = true);

-- Orders: only service role can read/write (admin panel uses service key)
-- Frontend never reads orders directly — only via Netlify functions
CREATE POLICY "Service role only for orders"
  ON shop_orders FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- NETLIFY ENVIRONMENT VARIABLES TO ADD:
-- SHOP_ADMIN_PASSWORD = choose a strong password for shop-admin.html login
-- SUPABASE_URL        = https://shaqvvvuqxgtkldnzpoh.supabase.co
-- SUPABASE_SERVICE_KEY = your service_role key (from Supabase > Settings > API)
-- SHOP_ADMIN_PASSWORD  = choose a strong password for shop-admin.html
-- STRIPE_SECRET_KEY    = sk_live_... (already set for Marge's)
-- ============================================================
