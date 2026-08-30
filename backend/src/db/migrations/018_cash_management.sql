-- Cash drawer management: shift cash entries + expected/actual/variance.
PRAGMA foreign_keys=off;

-- ── Cash entries per shift ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_cash_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('CASH_IN','CASH_OUT','SALE','REFUND')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  note TEXT,
  payment_id INTEGER,
  created_by INTEGER REFERENCES staff(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shift_cash_entries_shift ON shift_cash_entries (shift_id);

-- ── Recreate shifts with minor units + variance ───────────────────────────
CREATE TABLE shifts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  opened_at DATETIME,
  closed_at DATETIME,
  opening_cash REAL DEFAULT 0,
  closing_cash REAL DEFAULT 0,
  opening_cash_minor INTEGER NOT NULL DEFAULT 0,
  closing_cash_minor INTEGER,
  expected_cash_minor INTEGER,
  actual_cash_minor INTEGER,
  variance_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by INTEGER REFERENCES staff(id),
  note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO shifts_new (id, staff_id, opened_at, closed_at, opening_cash, closing_cash,
  opening_cash_minor, closing_cash_minor, status, closed_by, note, created_at, updated_at)
SELECT id, staff_id, opened_at, closed_at, opening_cash, closing_cash,
  CAST(ROUND(COALESCE(opening_cash,0) * 100) AS INTEGER),
  CASE WHEN closing_cash IS NOT NULL THEN CAST(ROUND(closing_cash * 100) AS INTEGER) ELSE NULL END,
  CASE WHEN closed_at IS NULL THEN 'open' ELSE 'closed' END,
  NULL, note, COALESCE(opened_at, CURRENT_TIMESTAMP), COALESCE(closed_at, CURRENT_TIMESTAMP)
FROM shifts;
DROP TABLE shifts;
ALTER TABLE shifts_new RENAME TO shifts;

-- One open shift per cashier
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_staff ON shifts (staff_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_shifts_staff_dates ON shifts (staff_id, opened_at);

PRAGMA foreign_keys=on;
