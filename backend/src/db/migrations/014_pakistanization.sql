-- Pakistanization migration: preserve legacy India/GST fields while adding configurable tax/payment snapshots.
PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS migration_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT
);
INSERT INTO migration_backups (name, note) VALUES ('014_pakistanization', 'Before recreating constrained staff/payments tables; legacy GST/HSN columns are preserved for historical compatibility.');
CREATE TABLE IF NOT EXISTS payments_legacy_014 AS SELECT * FROM payments;
CREATE TABLE IF NOT EXISTS staff_legacy_014 AS SELECT * FROM staff;

CREATE TABLE IF NOT EXISTS staff_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  role TEXT CHECK(role IN ('admin','manager','cashier','waiter','kitchen')) DEFAULT 'waiter',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO staff_new (id, name, pin, role, is_active, created_at)
SELECT id, name, pin, role, is_active, created_at FROM staff;
DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  provider TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  metadata TEXT
);
INSERT OR IGNORE INTO payment_methods (code, name, provider, sort_order) VALUES
('cash', 'Cash', 'cash', 1),
('card', 'Card', 'card', 2),
('jazzcash', 'JazzCash', 'jazzcash', 3),
('easypaisa', 'Easypaisa', 'easypaisa', 4),
('bank_transfer', 'Bank Transfer', 'bank_transfer', 5),
('other', 'Other', 'other', 6),
('unpaid', 'Customer Credit', 'other', 7);

CREATE TABLE payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  provider TEXT DEFAULT 'cash',
  method TEXT NOT NULL,
  amount REAL NOT NULL,
  amount_minor INTEGER,
  currency TEXT DEFAULT 'PKR',
  transaction_reference TEXT,
  provider_reference TEXT,
  status TEXT CHECK(status IN ('PENDING','AUTHORIZED','PAID','FAILED','CANCELLED','REFUNDED','EXPIRED')) DEFAULT 'PAID',
  reference TEXT,
  failure_reason TEXT,
  metadata TEXT,
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO payments_new (id, order_id, provider, method, amount, amount_minor, currency, transaction_reference, status, reference, paid_at, created_at, updated_at)
SELECT id, order_id,
  CASE WHEN method = 'upi' THEN 'other' ELSE COALESCE(method, 'cash') END,
  CASE WHEN method = 'upi' THEN 'other' ELSE COALESCE(method, 'cash') END,
  amount,
  CAST(ROUND(amount * 100) AS INTEGER),
  'PKR',
  reference,
  'PAID',
  reference,
  paid_at,
  COALESCE(paid_at, CURRENT_TIMESTAMP),
  COALESCE(paid_at, CURRENT_TIMESTAMP)
FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_txref ON payments(provider, transaction_reference) WHERE transaction_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments(order_id, status);

ALTER TABLE menu_items ADD COLUMN tax_name TEXT;
ALTER TABLE menu_items ADD COLUMN tax_rate REAL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN tax_mode TEXT DEFAULT 'exclusive';
ALTER TABLE menu_items ADD COLUMN dietary_label TEXT;
UPDATE menu_items SET tax_rate = COALESCE(cgst_rate, 0) + COALESCE(sgst_rate, 0), tax_name = 'Legacy GST' WHERE tax_rate IS NULL OR tax_rate = 0;

ALTER TABLE order_items ADD COLUMN unit_price_minor INTEGER;
ALTER TABLE order_items ADD COLUMN discount_minor INTEGER;
ALTER TABLE order_items ADD COLUMN tax_name TEXT;
ALTER TABLE order_items ADD COLUMN tax_rate REAL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN tax_mode TEXT DEFAULT 'exclusive';
ALTER TABLE order_items ADD COLUMN tax_amount_minor INTEGER DEFAULT 0;
UPDATE order_items SET
  unit_price_minor = CAST(ROUND(unit_price * 100) AS INTEGER),
  discount_minor = CAST(ROUND(COALESCE(discount, 0) * 100) AS INTEGER),
  tax_rate = COALESCE(cgst_rate, 0) + COALESCE(sgst_rate, 0),
  tax_name = CASE WHEN COALESCE(cgst_rate, 0) + COALESCE(sgst_rate, 0) > 0 THEN 'Legacy GST' ELSE 'Tax' END
WHERE unit_price_minor IS NULL;

ALTER TABLE bills ADD COLUMN currency TEXT DEFAULT 'PKR';
ALTER TABLE bills ADD COLUMN taxable_amount_minor INTEGER;
ALTER TABLE bills ADD COLUMN tax_name TEXT;
ALTER TABLE bills ADD COLUMN tax_rate REAL DEFAULT 0;
ALTER TABLE bills ADD COLUMN tax_mode TEXT DEFAULT 'exclusive';
ALTER TABLE bills ADD COLUMN tax_amount REAL DEFAULT 0;
ALTER TABLE bills ADD COLUMN tax_amount_minor INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN service_charge_amount REAL DEFAULT 0;
ALTER TABLE bills ADD COLUMN service_charge_minor INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN delivery_charge_amount REAL DEFAULT 0;
ALTER TABLE bills ADD COLUMN delivery_charge_minor INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN total_amount_minor INTEGER;
UPDATE bills SET
  taxable_amount_minor = CAST(ROUND(taxable_amount * 100) AS INTEGER),
  tax_amount = COALESCE(cgst_amount, 0) + COALESCE(sgst_amount, 0),
  tax_amount_minor = CAST(ROUND((COALESCE(cgst_amount, 0) + COALESCE(sgst_amount, 0)) * 100) AS INTEGER),
  total_amount_minor = CAST(ROUND(total_amount * 100) AS INTEGER),
  tax_name = CASE WHEN COALESCE(cgst_amount, 0) + COALESCE(sgst_amount, 0) > 0 THEN 'Legacy GST' ELSE 'Tax' END,
  tax_rate = 0
WHERE total_amount_minor IS NULL;

PRAGMA foreign_keys=on;
