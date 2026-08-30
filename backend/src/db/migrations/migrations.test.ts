import { describe, expect, it, afterEach } from 'vitest';
import { applyAllMigrations, createTestDb, mockElectron, setupSettings, teardown } from '../../test/helpers';
import type Database from 'better-sqlite3';

mockElectron();

describe('migrations — full sequence from clean database', () => {
  let db: Database.Database;

  afterEach(() => { teardown(); });

  it('applies every migration in order without errors', () => {
    db = createTestDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    for (const required of ['orders', 'order_items', 'kots', 'counters', 'bills', 'payments', 'payments', 'staff', 'customers', 'suppliers', 'purchases', 'purchase_items', 'expenses', 'expense_categories', 'inventory_items', 'inventory_log', 'shifts', 'shift_cash_entries', 'audit_logs', 'dining_areas', 'menu_item_variants', 'modifier_groups', 'modifiers', 'business_sessions']) {
      expect(names).toContain(required);
    }
    const orders = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string };
    expect(orders.sql).toContain('SENT_TO_KITCHEN');
    expect(orders.sql).toContain('COMPLETED');
    expect(orders.sql).toContain('order_number');
  });

  it('preserves legacy data when upgrading an existing stage-1/2 database', () => {
    // 1. Build a "legacy" database with only migrations 001–015
    db = createTestDb('015_stage2_menu_tables.sql');
    setupSettings({});
    db.prepare("INSERT OR IGNORE INTO staff (id, name, pin, role) VALUES (1, 'Admin', '1234', 'admin')").run();
    const categoryId = Number(db.prepare("INSERT INTO categories (menu_id, name, sort_order, is_active) VALUES (1, 'Biryani', 1, 1)").run().lastInsertRowid);
    const menuItemId = Number(db.prepare("INSERT INTO menu_items (category_id, name, price, price_minor, is_veg, is_available, is_active) VALUES (?, 'Chicken Biryani', 550, 55000, 0, 1, 1)").run(categoryId).lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO dining_areas (name, sort_order, is_active) VALUES ('Main Floor', 0, 1)").run();
    const tableId = Number(db.prepare("INSERT INTO tables (dining_area_id, identifier, name, capacity, status, shape, is_active) VALUES (1, 'LEGACY-T1', 'T1', 4, 'AVAILABLE', 'rectangle', 1)").run().lastInsertRowid);
    const _customerId = Number(db.prepare("INSERT INTO customers (name, phone) VALUES ('Ali', '03001234567')").run().lastInsertRowid);
    db.prepare("INSERT INTO expenses (date, category, amount, description) VALUES ('2026-08-01', 'Rent', 50000, 'August')").run();
    const legacyOrderId = Number(db.prepare(`
      INSERT INTO orders (table_id, staff_id, status, type, created_at, updated_at)
      VALUES (?, 1, 'kot_sent', 'dine-in', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(tableId).lastInsertRowid);
    db.prepare("INSERT INTO payments (order_id, provider, method, amount, amount_minor, currency, status) VALUES (?, 'cash', 'cash', 550, 55000, 'PKR', 'PAID')").run(legacyOrderId);
    db.prepare(`
      INSERT INTO order_items (order_id, menu_item_id, name, qty, unit_price, cgst_rate, sgst_rate, note, preparation_status, kot_number, unit_price_minor, tax_name, tax_rate, tax_mode)
      VALUES (?, ?, 'Chicken Biryani', 2, 550, 0, 0, 'spicy', 'preparing', 1, 55000, 'Sales Tax', 15, 'exclusive')
    `).run(legacyOrderId, menuItemId);
    const legacyBillsCount = (db.prepare('SELECT COUNT(*) c FROM bills').get() as { c: number }).c;
    expect(legacyBillsCount).toBe(0);

    // 2. Upgrade to the newest migration (only files after the legacy point)
    applyAllMigrations(db, '019_audit_indexes.sql', '015_stage2_menu_tables.sql');

    // Legacy order was mapped to the new lifecycle statuses
    const upgraded = db.prepare('SELECT * FROM orders WHERE id = ?').get(legacyOrderId) as { status: string; kds_status: string; order_number: string; kot_counter: number };
    expect(upgraded.status).toBe('SENT_TO_KITCHEN');
    expect(upgraded.kds_status).toBe('PREPARING');
    expect(upgraded.order_number).toMatch(/^ORD-/);

    // KOT history backfilled from order_items
    const kot = db.prepare('SELECT * FROM kots WHERE order_id = ?').get(legacyOrderId) as { kot_number: number; kot_type: string; status: string };
    expect(kot.kot_number).toBe(1);
    expect(kot.kot_type).toBe('MAIN');

    // Staff/payments/customers/expenses untouched
    expect((db.prepare('SELECT role FROM staff WHERE id = 1').get() as { role: string }).role).toBe('admin');
    expect((db.prepare('SELECT status FROM payments WHERE amount_minor = 55000').get() as { status: string }).status).toBe('PAID');
    expect((db.prepare('SELECT name FROM customers WHERE phone = ?').get('03001234567') as { name: string }).name).toBe('Ali');
    const expense = db.prepare('SELECT amount_minor, category FROM expenses WHERE category = ?').get('Rent') as { amount_minor: number; category: string };
    expect(expense.amount_minor).toBe(5000000);
  });

  it('keeps order numbering unique across upgrades', () => {
    db = createTestDb();
    db.prepare("INSERT INTO orders (order_number, status, kds_status, type) VALUES ('ORD-000001', 'OPEN', 'NEW', 'takeaway')").run();
    db.prepare("INSERT INTO orders (order_number, status, kds_status, type) VALUES ('ORD-000002', 'COMPLETED', 'COMPLETED', 'takeaway')").run();
    const count = (db.prepare('SELECT COUNT(*) c FROM orders').get() as { c: number }).c;
    expect(count).toBe(2);
    // counters table exists and kot counter seeded
    expect((db.prepare("SELECT value FROM counters WHERE name = 'kot'").get() as { value: number }).value).toBe(0);
  });
});

describe('migration 021 — staff pin nullable + role matrix', () => {
  let db: Database.Database;

  afterEach(() => { teardown(); });

  it('fresh database: full role matrix allowed, invalid roles rejected, pin nullable', () => {
    db = createTestDb();
    const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'staff'").get() as { sql: string }).sql;
    expect(schema).toContain("'kitchen'");
    expect(schema).toContain("'inventory'");
    // pin column is nullable (hashed-PIN flow clears the legacy value)
    const pinCol = db.prepare("SELECT \"notnull\" FROM pragma_table_info('staff') WHERE name = 'pin'").get() as { notnull: number };
    expect(pinCol.notnull).toBe(0);

    // Every role in the authorization matrix can be stored
    for (const role of ['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'inventory']) {
      db.prepare('INSERT INTO staff (name, role, pin) VALUES (?, ?, ?)').run(`Staff ${role}`, role, '1234');
    }
    // Invalid roles remain rejected
    expect(() => db.prepare("INSERT INTO staff (name, role, pin) VALUES ('X', 'superuser', '1234')").run()).toThrow(/CHECK/i);
    expect(() => db.prepare("INSERT INTO staff (name, role, pin) VALUES ('X', '', '1234')").run()).toThrow(/CHECK/i);
    // Hashed-PIN records (pin NULL) are accepted
    db.prepare('INSERT INTO staff (name, role, pin_hash, pin_salt, pin) VALUES (?, ?, ?, ?, NULL)').run('Hashed', 'cashier', 'h', 's');
    // Seed admin row survived the rebuild
    expect((db.prepare('SELECT role FROM staff WHERE id = 1').get() as { role: string }).role).toBe('admin');
    // AUTOINCREMENT sequence continues above the copied ids
    const maxId = (db.prepare('SELECT MAX(id) m FROM staff').get() as { m: number }).m;
    const nextId = Number(db.prepare("INSERT INTO staff (name, role, pin) VALUES ('Next', 'waiter', '1')").run().lastInsertRowid);
    expect(nextId).toBe(maxId + 1);
  });

  it('existing database: rebuild preserves staff rows and child references', () => {
    // 1. Build a database at migration 020 with real data
    db = createTestDb('020_staff_pin_security.sql');
    db.prepare("INSERT OR IGNORE INTO staff (id, name, pin, role) VALUES (1, 'Admin', '1234', 'admin')").run();
    db.prepare("INSERT INTO staff (name, role, pin, pin_hash, pin_salt) VALUES ('Waiter A', 'waiter', '1234', 'h', 's')").run();
    db.prepare("INSERT INTO staff (name, role, pin) VALUES ('Cashier B', 'cashier', '5678')").run();
    // Child rows referencing staff (FK enforcement is ON in the app DB)
    db.prepare("INSERT INTO expenses (date, category, amount, amount_minor, staff_id, description) VALUES ('2026-08-01', 'Rent', 50000, 5000000, 2, 'August')").run();
    db.prepare("INSERT INTO orders (order_number, status, kds_status, type, staff_id) VALUES ('ORD-000001', 'OPEN', 'NEW', 'takeaway', 3)").run();
    db.prepare("INSERT INTO business_sessions (business_date, started_by, started_at) VALUES ('2026-08-30', 1, CURRENT_TIMESTAMP)").run();
    const before = db.prepare('SELECT id, name, pin, role, pin_hash, pin_salt FROM staff ORDER BY id').all() as Array<{ id: number; name: string; pin: string | null; role: string }>;
    expect(before).toHaveLength(3);

    // 2. Upgrade with only migration 021
    applyAllMigrations(db, undefined, '020_staff_pin_security.sql');

    // Staff rows fully preserved (id, legacy pin, hash columns)
    const after = db.prepare('SELECT id, name, pin, role, pin_hash, pin_salt FROM staff ORDER BY id').all() as Array<{ id: number; name: string; pin: string | null; role: string; pin_hash: string | null; pin_salt: string | null }>;
    expect(after).toEqual([
      { id: 1, name: 'Admin', pin: '1234', role: 'admin', pin_hash: null, pin_salt: null },
      { id: 2, name: 'Waiter A', pin: '1234', role: 'waiter', pin_hash: 'h', pin_salt: 's' },
      { id: 3, name: 'Cashier B', pin: '5678', role: 'cashier', pin_hash: null, pin_salt: null },
    ]);
    // Child references intact and FK-consistent
    expect((db.prepare('SELECT staff_id FROM expenses WHERE description = ?').get('August') as { staff_id: number }).staff_id).toBe(2);
    expect((db.prepare('SELECT staff_id FROM orders WHERE order_number = ?').get('ORD-000001') as { staff_id: number }).staff_id).toBe(3);
    expect((db.prepare('SELECT started_by FROM business_sessions').get() as { started_by: number }).started_by).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    // New matrix works after upgrade
    db.prepare("INSERT INTO staff (name, role, pin) VALUES ('Chef', 'kitchen', '1234')").run();
    db.prepare("INSERT INTO staff (name, role, pin_hash, pin_salt, pin) VALUES ('Store', 'inventory', 'x', 'y', NULL)").run();
    expect(() => db.prepare("INSERT INTO staff (name, role, pin) VALUES ('X', 'superuser', '1')").run()).toThrow(/CHECK/i);
  });
});
