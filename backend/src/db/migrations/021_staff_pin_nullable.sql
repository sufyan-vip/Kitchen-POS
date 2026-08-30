-- Make staff.pin nullable so the hashed-PIN flow can clear the legacy
-- plaintext value: staff:upsert, change-pin and admin setup all write
-- pin = NULL once pin_hash/pin_salt are set (see migration 020 and
-- ipc/staff.ts applyHashedPin). The NOT NULL constraint inherited from
-- migration 001 rejects those writes, so hashed staff records could never
-- be created.
--
-- The role CHECK was already expanded to the full authorization matrix
-- (admin, manager, cashier, waiter, kitchen, inventory) by migration 016;
-- this rebuild preserves that constraint verbatim while relaxing pin.
--
-- SQLite cannot change column nullability in place, so the table is rebuilt
-- following the same pattern as migration 016. The migration runner suspends
-- foreign-key enforcement for the duration of the migration (each file stays
-- atomic inside its own transaction) and restores it immediately after, so
-- child rows (orders.staff_id, expenses.staff_id, ...) remain valid: every
-- existing staff id is preserved by the copy below.

CREATE TABLE staff_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT,
  role TEXT CHECK(role IN ('admin','manager','cashier','waiter','kitchen','inventory')) DEFAULT 'waiter',
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  pin_hash TEXT,
  pin_salt TEXT
);

INSERT INTO staff_new (id, name, pin, role, is_active, created_at, pin_hash, pin_salt)
  SELECT id, name, pin, role, is_active, created_at, pin_hash, pin_salt FROM staff;

DROP TABLE staff;
ALTER TABLE staff_new RENAME TO staff;
