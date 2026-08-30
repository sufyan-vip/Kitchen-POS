-- Order lifecycle: authoritative order statuses, order numbers, KOT table,
-- pricing snapshots on orders, and the 'inventory' staff role.
-- Legacy statuses are mapped: open -> OPEN, kot_sent -> SENT_TO_KITCHEN,
-- billed -> COMPLETED, cancelled -> CANCELLED.

-- ── Monotonic counters (order / KOT / bill numbers) ───────────────────────
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('order', 0);
INSERT OR IGNORE INTO counters (name, value) VALUES ('kot', 0);

-- Seed KOT counter from existing per-order kot numbers so new global KOT
-- numbers never collide with legacy numbers.
UPDATE counters SET value = COALESCE((SELECT MAX(kot_number) FROM order_items), 0)
WHERE name = 'kot' AND COALESCE((SELECT MAX(kot_number) FROM order_items), 0) > (SELECT value FROM counters WHERE name = 'kot');

-- ── Recreate orders with lifecycle statuses + authoritative snapshots ─────
PRAGMA foreign_keys=off;

CREATE TABLE orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  table_id INTEGER REFERENCES tables(id),
  staff_id INTEGER REFERENCES staff(id),
  customer_id INTEGER REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','SENT_TO_KITCHEN','PREPARING','READY','SERVED','COMPLETED','CANCELLED')),
  kds_status TEXT NOT NULL DEFAULT 'NEW' CHECK (kds_status IN ('NEW','PREPARING','READY','COMPLETED','CANCELLED')),
  type TEXT NOT NULL DEFAULT 'dine-in' CHECK (type IN ('dine-in','takeaway','delivery')),
  covers INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  business_date TEXT,
  -- Discount applied at order level
  discount_type TEXT CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','FIXED')),
  discount_percent REAL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  -- Authoritative totals (integer PKR minor units), recomputed server-side
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  taxable_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  service_charge_minor INTEGER NOT NULL DEFAULT 0,
  delivery_charge_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  total_paid_minor INTEGER NOT NULL DEFAULT 0,
  -- Tax snapshot at order time
  tax_name TEXT,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_mode TEXT NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('exclusive','inclusive')),
  -- Delivery foundation
  delivery_address TEXT,
  delivery_partner TEXT,
  -- Lifecycle metadata
  kot_counter INTEGER NOT NULL DEFAULT 0,
  completed_at DATETIME,
  cancelled_by INTEGER REFERENCES staff(id),
  cancel_reason TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders_new (
  id, order_number, table_id, staff_id, customer_id, status, kds_status, type, covers, note,
  business_date, discount_type, discount_percent, discount_minor,
  subtotal_minor, taxable_minor, tax_minor, service_charge_minor, delivery_charge_minor,
  total_minor, total_paid_minor, tax_name, tax_rate, tax_mode,
  kot_counter, completed_at, cancelled_by, cancel_reason, created_at, updated_at
)
SELECT
  id,
  'ORD-' || printf('%06d', id),
  table_id, staff_id, customer_id,
  CASE status WHEN 'open' THEN 'OPEN' WHEN 'kot_sent' THEN 'SENT_TO_KITCHEN' WHEN 'billed' THEN 'COMPLETED' WHEN 'cancelled' THEN 'CANCELLED' ELSE 'OPEN' END,
  CASE status WHEN 'kot_sent' THEN 'PREPARING' WHEN 'billed' THEN 'COMPLETED' WHEN 'cancelled' THEN 'CANCELLED' ELSE 'NEW' END,
  COALESCE(type, 'dine-in'),
  COALESCE(covers, 1),
  note,
  business_date,
  NULL, NULL, 0,
  0, 0, 0, 0, 0, 0, 0, NULL, 0, 'exclusive',
  COALESCE((SELECT MAX(kot_number) FROM order_items oi WHERE oi.order_id = orders.id), 0),
  NULL, NULL, NULL,
  COALESCE(created_at, CURRENT_TIMESTAMP),
  COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

-- One active order per table (prevents double-assignment races)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_open_per_table
  ON orders (table_id) WHERE status NOT IN ('COMPLETED','CANCELLED') AND table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_type_created ON orders (type, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_business_date ON orders (business_date);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);

-- ── Order items: variant/modifier snapshots + line totals ─────────────────
ALTER TABLE order_items ADD COLUMN variant_id INTEGER;
ALTER TABLE order_items ADD COLUMN variant_name TEXT;
ALTER TABLE order_items ADD COLUMN modifier_snapshot TEXT;
ALTER TABLE order_items ADD COLUMN line_total_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN created_at DATETIME;

UPDATE order_items SET
  line_total_minor = COALESCE(line_total_minor, 0) + COALESCE(unit_price_minor, CAST(ROUND(COALESCE(unit_price,0) * 100) AS INTEGER)) * qty,
  created_at = COALESCE(created_at, CURRENT_TIMESTAMP)
WHERE line_total_minor = 0;

CREATE INDEX IF NOT EXISTS idx_order_items_order_kot ON order_items (order_id, kot_number);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item ON order_items (menu_item_id);

-- ── KOT table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kot_number INTEGER NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  table_id INTEGER REFERENCES tables(id),
  kot_type TEXT NOT NULL DEFAULT 'MAIN' CHECK (kot_type IN ('MAIN','ADDITIONAL')),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','PREPARING','READY','COMPLETED','CANCELLED')),
  printed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES staff(id),
  note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kots_order ON kots (order_id);
CREATE INDEX IF NOT EXISTS idx_kots_status_created ON kots (status, created_at);

-- Backfill KOT history from existing order_items so old tickets survive
INSERT OR IGNORE INTO kots (kot_number, order_id, table_id, kot_type, status, printed, created_at, updated_at)
SELECT
  oi.kot_number,
  oi.order_id,
  o.table_id,
  CASE WHEN oi.kot_number = 1 THEN 'MAIN' ELSE 'ADDITIONAL' END,
  CASE o.status WHEN 'COMPLETED' THEN 'COMPLETED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'NEW' END,
  0,
  o.created_at,
  o.updated_at
FROM (SELECT order_id, kot_number, MIN(id) AS first_id FROM order_items WHERE kot_number IS NOT NULL GROUP BY order_id, kot_number) oi
JOIN orders o ON o.id = oi.order_id;

-- ── Staff: add 'inventory' role ───────────────────────────────────────────
CREATE TABLE staff_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin','manager','cashier','waiter','kitchen','inventory')) DEFAULT 'waiter',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO staff_new (id, name, pin, role, is_active, created_at)
SELECT id, name, pin, role, is_active, created_at FROM staff;
DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;

PRAGMA foreign_keys=on;
