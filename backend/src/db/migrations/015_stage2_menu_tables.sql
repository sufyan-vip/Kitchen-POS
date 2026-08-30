-- Stage 2 menu and table management.
-- Legacy categories, menu_items, and tables are extended in place so existing
-- orders and Pakistanized tax/payment data remain intact.

ALTER TABLE categories ADD COLUMN created_at DATETIME;
ALTER TABLE categories ADD COLUMN updated_at DATETIME;
UPDATE categories SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);

ALTER TABLE menu_items ADD COLUMN price_minor INTEGER;
ALTER TABLE menu_items ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE menu_items ADD COLUMN created_at DATETIME;
ALTER TABLE menu_items ADD COLUMN updated_at DATETIME;
UPDATE menu_items
SET price_minor = COALESCE(price_minor, CAST(ROUND(COALESCE(price, 0) * 100) AS INTEGER)),
    created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS menu_item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(menu_item_id, name)
);

CREATE TABLE IF NOT EXISTS modifier_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  selection_type TEXT NOT NULL DEFAULT 'multiple' CHECK (selection_type IN ('single', 'multiple')),
  min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections INTEGER CHECK (max_selections IS NULL OR max_selections >= min_selections),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modifier_group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(modifier_group_id, name)
);

CREATE TABLE IF NOT EXISTS menu_item_modifier_groups (
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  modifier_group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(menu_item_id, modifier_group_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_variants_item_active ON menu_item_variants(menu_item_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_modifiers_group_active ON modifiers(modifier_group_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifier_groups_group ON menu_item_modifier_groups(modifier_group_id, sort_order);

CREATE TABLE IF NOT EXISTS dining_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO dining_areas (name, sort_order) VALUES ('Main Floor', 0);

ALTER TABLE tables ADD COLUMN dining_area_id INTEGER REFERENCES dining_areas(id) ON DELETE RESTRICT;
ALTER TABLE tables ADD COLUMN identifier TEXT;
ALTER TABLE tables ADD COLUMN status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'DISABLED'));
ALTER TABLE tables ADD COLUMN position_x REAL NOT NULL DEFAULT 24;
ALTER TABLE tables ADD COLUMN position_y REAL NOT NULL DEFAULT 24;
ALTER TABLE tables ADD COLUMN width REAL NOT NULL DEFAULT 132;
ALTER TABLE tables ADD COLUMN height REAL NOT NULL DEFAULT 88;
ALTER TABLE tables ADD COLUMN rotation REAL NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN shape TEXT NOT NULL DEFAULT 'rectangle' CHECK (shape IN ('rectangle', 'round'));
ALTER TABLE tables ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE tables ADD COLUMN created_at DATETIME;
ALTER TABLE tables ADD COLUMN updated_at DATETIME;

UPDATE tables
SET dining_area_id = COALESCE(dining_area_id, (SELECT id FROM dining_areas WHERE name = 'Main Floor' LIMIT 1)),
    identifier = COALESCE(NULLIF(identifier, ''), NULLIF(name, ''), 'TABLE-' || id),
    created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
    updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_tables_area_active ON tables(dining_area_id, is_active, identifier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_area_identifier_active ON tables(dining_area_id, identifier) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_tables_area_layout ON tables(dining_area_id, position_x, position_y);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  actor_role TEXT,
  details TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
