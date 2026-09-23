CREATE TABLE IF NOT EXISTS restaurants (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  cuisine      TEXT NOT NULL,
  city         TEXT NOT NULL,
  country      TEXT NOT NULL,
  phone        TEXT,
  rating       REAL NOT NULL DEFAULT 0,
  price_range  INTEGER NOT NULL DEFAULT 2 CHECK (price_range BETWEEN 1 AND 4),
  is_open      INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restaurants_cuisine ON restaurants (cuisine);
CREATE INDEX IF NOT EXISTS idx_restaurants_city     ON restaurants (city);
CREATE INDEX IF NOT EXISTS idx_restaurants_rating   ON restaurants (rating);

CREATE TABLE IF NOT EXISTS menu_items (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,
  price         REAL NOT NULL CHECK (price >= 0),
  is_available  INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category   ON menu_items (category);
CREATE INDEX IF NOT EXISTS idx_menu_items_price      ON menu_items (price);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  subtotal      REAL NOT NULL DEFAULT 0,
  delivery_fee  REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT '',
  placed_at     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_placed_at  ON orders (placed_at);

CREATE TABLE IF NOT EXISTS order_items (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id TEXT NOT NULL REFERENCES menu_items (id) ON DELETE RESTRICT,
  item_name    TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price   REAL NOT NULL CHECK (unit_price >= 0),
  line_total   REAL NOT NULL CHECK (line_total >= 0),
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order      ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item  ON order_items (menu_item_id);
