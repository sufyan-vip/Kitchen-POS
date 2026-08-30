-- Suppliers, purchasing, expenses hardening, and extended inventory movements.
PRAGMA foreign_keys=off;

-- ── Suppliers ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_suppliers_active_name ON suppliers (is_active, name);

-- ── Purchases ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ORDERED' CHECK (status IN ('ORDERED','RECEIVED','CANCELLED')),
  total_minor INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES staff(id),
  received_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases (status, created_at);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  qty REAL NOT NULL CHECK (qty > 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  line_total_minor INTEGER NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);

-- ── Expense categories ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO expense_categories (name, sort_order) VALUES
  ('Rent', 1), ('Utilities', 2), ('Salaries', 3), ('Ingredients', 4),
  ('Maintenance', 5), ('Marketing', 6), ('Transport', 7), ('Other', 99);

-- ── Expenses: minor units + payment method ────────────────────────────────
ALTER TABLE expenses ADD COLUMN amount_minor INTEGER;
ALTER TABLE expenses ADD COLUMN payment_method TEXT DEFAULT 'cash';
ALTER TABLE expenses ADD COLUMN updated_at DATETIME;
UPDATE expenses SET
  amount_minor = COALESCE(amount_minor, CAST(ROUND(COALESCE(amount,0) * 100) AS INTEGER)),
  updated_at = COALESCE(updated_at, created_at)
WHERE amount_minor IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date);

-- ── Inventory items: active flag + timestamps ─────────────────────────────
ALTER TABLE inventory_items ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1));
ALTER TABLE inventory_items ADD COLUMN created_at DATETIME;
ALTER TABLE inventory_items ADD COLUMN updated_at DATETIME;
UPDATE inventory_items SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON inventory_items (is_active, name);

-- ── Inventory log: extended movement types + references ──────────────────
CREATE TABLE inventory_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','adjustment','wastage','return','correction')),
  qty_change REAL NOT NULL,
  stock_after REAL NOT NULL DEFAULT 0,
  unit_cost_minor INTEGER,
  reference TEXT,
  note TEXT,
  created_by INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO inventory_log_new (id, item_id, type, qty_change, stock_after, unit_cost_minor, reference, note, created_by, created_at)
SELECT id, item_id,
  CASE type WHEN 'wastage' THEN 'wastage' ELSE type END,
  qty_change, 0, NULL, NULL, note, NULL, COALESCE(created_at, CURRENT_TIMESTAMP)
FROM inventory_log;
DROP TABLE inventory_log;
ALTER TABLE inventory_log_new RENAME TO inventory_log;
CREATE INDEX IF NOT EXISTS idx_inventory_log_item_created ON inventory_log (item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_log_type ON inventory_log (type, created_at);

PRAGMA foreign_keys=on;
