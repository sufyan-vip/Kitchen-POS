-- Audit actor tracking + report/migration supporting indexes.
PRAGMA foreign_keys=off;

-- ── Audit logs: staff actor + unrestricted admin read ─────────────────────
CREATE TABLE audit_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  actor_role TEXT,
  staff_id INTEGER REFERENCES staff(id),
  details TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO audit_logs_new (id, action, entity_type, entity_id, actor_role, staff_id, details, created_at)
SELECT id, action, entity_type, entity_id, actor_role, NULL, details, created_at FROM audit_logs;
DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at);

-- ── Supporting indexes for reports / dashboards / KDS ─────────────────────
CREATE INDEX IF NOT EXISTS idx_bills_created_at ON bills (created_at);
CREATE INDEX IF NOT EXISTS idx_bills_order_id ON bills (order_id);
CREATE INDEX IF NOT EXISTS idx_bills_business_date ON bills (business_date);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (COALESCE(paid_at, created_at));
CREATE INDEX IF NOT EXISTS idx_order_items_prep ON order_items (preparation_status, order_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);

PRAGMA foreign_keys=on;
