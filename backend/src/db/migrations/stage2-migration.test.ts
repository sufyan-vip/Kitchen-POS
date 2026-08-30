import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Statement {
  run(...parameters: unknown[]): { changes: number; lastInsertRowid: number };
  get(...parameters: unknown[]): Record<string, unknown> | undefined;
  all(...parameters: unknown[]): Array<Record<string, unknown>>;
}

interface SqliteDatabase {
  pragma(statement: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

const { DatabaseSync } = createRequire(__filename)('node:sqlite') as SqliteModule;
const migrationPath = resolve(__dirname, '015_stage2_menu_tables.sql');

function migratedDatabase(): SqliteDatabase {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE menus (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, menu_id INTEGER DEFAULT 1);
    CREATE TABLE menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, name TEXT NOT NULL, price REAL NOT NULL, is_veg INTEGER DEFAULT 1, is_available INTEGER DEFAULT 1);
    CREATE TABLE tables (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, capacity INTEGER DEFAULT 4, section TEXT DEFAULT 'Main');
    INSERT INTO menus (id, name) VALUES (1, 'Main Menu');
    INSERT INTO categories (id, name, menu_id) VALUES (1, 'Breakfast', 1);
    INSERT INTO menu_items (id, category_id, name, price) VALUES (1, 1, 'Paratha', 125.5);
    INSERT INTO tables (id, name, capacity) VALUES (1, 'T-01', 4);
  `);
  database.exec(readFileSync(migrationPath, 'utf8'));
  return database;
}

describe('Stage 2 migration', () => {
  it('extends legacy records and creates all management tables', () => {
    const database = migratedDatabase();
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables.map(table => table.name)).toEqual(expect.arrayContaining([
      'menu_item_variants', 'modifier_groups', 'modifiers', 'menu_item_modifier_groups', 'dining_areas', 'audit_logs',
    ]));
    expect(database.prepare('SELECT price_minor FROM menu_items WHERE id = 1').get()).toEqual({ price_minor: 12550 });
    expect(database.prepare('SELECT dining_area_id, identifier, status FROM tables WHERE id = 1').get()).toMatchObject({ identifier: 'T-01', status: 'AVAILABLE' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM dining_areas').get()).toEqual({ count: 1 });
    database.close();
  });

  it('protects duplicate active table identifiers in an area', () => {
    const database = migratedDatabase();
    expect(() => { database.prepare(`INSERT INTO tables (dining_area_id, identifier, name, capacity) VALUES (1, 'T-01', 'Duplicate', 2)`).run(); }).toThrow();
    database.close();
  });

  it('protects modifier history with foreign keys', () => {
    const database = migratedDatabase();
    database.prepare("INSERT INTO modifier_groups (name) VALUES ('Toppings')").run();
    const group = database.prepare("SELECT id FROM modifier_groups WHERE name = 'Toppings'").get() as { id: number };
    database.prepare("INSERT INTO modifiers (modifier_group_id, name, price_minor) VALUES (?, 'Cheese', 1500)").run(group.id);
    expect(() => { database.prepare('DELETE FROM modifier_groups WHERE id = ?').run(group.id); }).toThrow();
    database.close();
  });
});
