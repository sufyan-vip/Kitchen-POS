-- DEFAULT PIN IS 1234 — CHANGE IMMEDIATELY
INSERT OR IGNORE INTO staff (id, name, pin, role) VALUES (1, 'Admin', '1234', 'admin');

-- Minimal neutral starter data only. Restaurants should create their own Pakistan-specific categories/items.
INSERT OR IGNORE INTO categories (id, name, sort_order) VALUES
(1, 'Default Category', 1);

INSERT OR IGNORE INTO tables (id, name) VALUES
(1, 'T1'), (2, 'T2'), (3, 'T3'), (4, 'T4'), (5, 'T5'),
(6, 'T6'), (7, 'T7'), (8, 'T8'), (9, 'T9'), (10, 'T10');
