/**
 * Test helpers: real SQLite + real migrations, mocked electron shell and
 * an in-memory settings store. Services under test are exercised exactly as
 * they run in the main process (minus the BrowserWindow layer).
 */
import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { setSettingsStore, SettingsStore } from '../services/settings';
import { setCurrentRole, setCurrentStaffId } from '../services/authz';
import { getDB, closeDB } from '../db';

export function mockElectron(): void {
  vi.mock('electron', () => {
    const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pos-userdata-')), 'userData');
    fs.mkdirSync(userData, { recursive: true });
    return {
      app: {
        getPath: () => userData,
        whenReady: () => Promise.resolve(),
        isPackaged: false,
      },
      BrowserWindow: { getAllWindows: (): unknown[] => [] },
      ipcMain: { handle: () => undefined },
      dialog: { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) },
    };
  });
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

export function applyAllMigrations(db: Database.Database, upTo?: string, from?: string): string[] {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (upTo && file > upTo) { break; }
    if (from && file <= from) { continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      // Mirrors src/db/migrate.ts: suspend FK enforcement around each
      // migration so table-rebuild migrations (016, 021) work even when
      // child rows reference the rebuilt table.
      db.pragma('foreign_keys = OFF');
      db.transaction(() => { db.exec(sql); })();
      db.pragma('foreign_keys = ON');
    } catch (e) { console.error('MIG FAIL:', file); throw e; }
  }
  return files;
}

export function createTestDb(upTo?: string): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-db-'));
  const dbPath = path.join(dir, 'pos.db');
  closeDB();
  process.env.POS_DB_PATH = dbPath;
  const db = getDB();
  applyAllMigrations(db, upTo);
  return db;
}

export function resetAuth(): void {
  setCurrentRole('admin');
  setCurrentStaffId(1);
}

const memStore = new Map<string, unknown>();

export function setupSettings(overrides: Record<string, unknown> = {}): void {
  memStore.clear();
  Object.entries(overrides).forEach(([k, v]) => memStore.set(k, v));
  const mock: SettingsStore = {
    get: (key: string, defaultValue?: unknown) => (memStore.has(key) ? memStore.get(key) : defaultValue),
    set: (key: string, value: unknown) => { memStore.set(key, value); },
  };
  setSettingsStore(mock);
}

export function seedMinimalMenu(db: Database.Database): { menuItemId: number; categoryId: number } {
  const cat = db.prepare('INSERT INTO categories (menu_id, name, sort_order, is_active) VALUES (1, ?, 1, 1)').run('Food');
  const categoryId = Number(cat.lastInsertRowid);
  const item = db.prepare(`
    INSERT INTO menu_items (category_id, name, price, price_minor, tax_name, tax_rate, tax_mode, is_veg, is_available, is_active, sort_order)
    VALUES (?, ?, 10, 1000, 'Sales Tax', 15, 'exclusive', 1, 1, 1, 1)
  `).run(categoryId, 'Burger');
  const menuItemId = Number(item.lastInsertRowid);
  const inv = db.prepare("INSERT INTO inventory_items (name, unit, qty_in_stock, low_stock_alert_at, cost_per_unit) VALUES ('Bun', 'pcs', 100, 10, 30)").run();
  const invId = Number(inv.lastInsertRowid);
  db.prepare('INSERT INTO menu_inventory_map (menu_item_id, inventory_item_id, qty_used) VALUES (?, ?, 2)').run(menuItemId, invId);
  return { menuItemId, categoryId };
}

export function seedVariant(db: Database.Database, menuItemId: number, name: string, priceMinor: number): number {
  const info = db.prepare('INSERT INTO menu_item_variants (menu_item_id, name, price_minor, is_active, sort_order) VALUES (?, ?, ?, 1, 0)')
    .run(menuItemId, name, priceMinor);
  return Number(info.lastInsertRowid);
}

export function seedModifierGroup(db: Database.Database, name: string, min = 0, max: number | null = null): number {
  const info = db.prepare('INSERT INTO modifier_groups (name, selection_type, min_selections, max_selections, is_active, sort_order) VALUES (?, ?, ?, ?, 1, 0)')
    .run(name, 'multiple', min, max);
  return Number(info.lastInsertRowid);
}

export function seedModifier(db: Database.Database, groupId: number, name: string, priceMinor: number): number {
  const info = db.prepare('INSERT INTO modifiers (modifier_group_id, name, price_minor, is_active, sort_order) VALUES (?, ?, ?, 1, 0)')
    .run(groupId, name, priceMinor);
  return Number(info.lastInsertRowid);
}

export function linkModifierGroup(db: Database.Database, menuItemId: number, groupId: number): void {
  db.prepare('INSERT INTO menu_item_modifier_groups (menu_item_id, modifier_group_id, sort_order) VALUES (?, ?, 0)').run(menuItemId, groupId);
}

export function seedMenuWithVariantAndModifiers(db: Database.Database): {
  menuItemId: number; variantId: number; cheeseId: number; extraPattyId: number;
} {
  const item = db.prepare(`
    INSERT INTO menu_items (category_id, name, price, price_minor, tax_name, tax_rate, tax_mode, is_veg, is_available, is_active, sort_order)
    VALUES (1, 'Burger', 10, 1000, 'Sales Tax', 15, 'exclusive', 0, 1, 1, 1)
  `).run();
  const menuItemId = Number(item.lastInsertRowid);
  const variantId = seedVariant(db, menuItemId, 'Large', 1500);
  const groupId = seedModifierGroup(db, 'Extras', 0, 3);
  const cheeseId = seedModifier(db, groupId, 'Cheese', 150);
  const extraPattyId = seedModifier(db, groupId, 'Extra Patty', 300);
  const singleGroup = seedModifierGroupSingle(db, 'Size Choice');
  seedModifier(db, singleGroup, 'Small', 0);
  seedModifier(db, singleGroup, 'Medium', 100);
  linkModifierGroup(db, menuItemId, groupId);
  linkModifierGroup(db, menuItemId, singleGroup);
  return { menuItemId, variantId, cheeseId, extraPattyId };
}

function seedModifierGroupSingle(db: Database.Database, name: string): number {
  const info = db.prepare("INSERT INTO modifier_groups (name, selection_type, min_selections, max_selections, is_active, sort_order) VALUES (?, 'single', 0, 1, 1, 0)")
    .run(name);
  return Number(info.lastInsertRowid);
}

let areaSeq = 0;

export function seedTable(db: Database.Database, name = 'T1'): number {
  areaSeq += 1;
  const area = db.prepare('INSERT INTO dining_areas (name, sort_order, is_active) VALUES (?, 0, 1)').run(`Area-${Date.now()}-${areaSeq}`);
  const areaId = Number(area.lastInsertRowid);
  const info = db.prepare(`
    INSERT INTO tables (dining_area_id, identifier, name, capacity, status, shape, is_active, position_x, position_y, width, height, rotation)
    VALUES (?, ?, ?, 4, 'AVAILABLE', 'rectangle', 1, 24, 24, 132, 88, 0)
  `).run(areaId, name, name);
  return Number(info.lastInsertRowid);
}

export function seedCustomer(db: Database.Database, name = 'Ali', phone = '03001234567'): number {
  const info = db.prepare('INSERT INTO customers (name, phone, credit_limit, outstanding_balance) VALUES (?, ?, 5000, 0)').run(name, phone);
  return Number(info.lastInsertRowid);
}

export function teardown(): void {
  closeDB();
  setSettingsStore(null);
  setCurrentRole(null);
  setCurrentStaffId(null);
}

export function expectDefined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) { throw new Error(`Expected ${label} to be defined`); }
  return value;
}
