import type Database from 'better-sqlite3';
import { getDB } from '../db';
import { fromMinorUnits } from './money';
import { writeAuditLog } from './audit';
import { assertCurrentPermission } from './authz';
import {
  TableShape,
  TableStatus,
  SelectionType,
  validateBooleanFlag,
  validateGroupSelection,
  validateIdentifier,
  validateLayoutPosition,
  validateMoneyMinor,
  validateName,
  validateSortOrder,
  validateTableShape,
  validateTableStatus,
  validateInteger,
} from './stage2-validation';

export interface CategoryInput {
  id?: number;
  menu_id: number;
  name: string;
  sort_order?: number;
  is_active?: number | boolean;
}

export interface MenuItemInput {
  id?: number;
  category_id: number;
  name: string;
  price?: number | string;
  price_minor?: number;
  is_veg?: number | boolean;
  is_available?: number | boolean;
  is_active?: number | boolean;
  sort_order?: number;
  tax_name?: string | null;
  tax_rate?: number | null;
  tax_mode?: 'exclusive' | 'inclusive' | null;
  dietary_label?: string | null;
}

export interface VariantInput {
  id?: number;
  menu_item_id: number;
  name: string;
  price?: number | string;
  price_minor?: number;
  is_active?: number | boolean;
  sort_order?: number;
}

export interface ModifierGroupInput {
  id?: number;
  name: string;
  selection_type?: SelectionType;
  min_selections?: number;
  max_selections?: number | null;
  is_active?: number | boolean;
  sort_order?: number;
}

export interface ModifierInput {
  id?: number;
  modifier_group_id: number;
  name: string;
  price?: number | string;
  price_minor?: number;
  is_active?: number | boolean;
  sort_order?: number;
}

export interface DiningAreaInput {
  id?: number;
  name: string;
  sort_order?: number;
  is_active?: number | boolean;
}

export interface TableInput {
  id?: number;
  dining_area_id: number;
  identifier: string;
  name?: string;
  capacity: number;
  status?: TableStatus;
  shape?: TableShape;
  is_active?: number | boolean;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

function db(): Database.Database {
  return getDB();
}

function requiredId(value: unknown, field: string): number {
  return validateInteger(value, field, 1);
}

function moneyFromInput(input: { price?: number | string; price_minor?: number }, field = 'Price'): number {
  if (input.price_minor !== undefined) {
    return validateMoneyMinor(input.price_minor, field);
  }
  return validateMoneyMinor(input.price ?? 0, field);
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return validateName(value, field);
}

export function listCategories(menuId: number, includeInactive = false): unknown[] {
  assertCurrentPermission('menu_viewing');
  const id = requiredId(menuId, 'Menu id');
  const activeClause = includeInactive ? '' : ' AND is_active = 1';
  return db().prepare(`
    SELECT id, menu_id, name, sort_order, is_active, created_at, updated_at
    FROM categories WHERE menu_id = ?${activeClause} ORDER BY sort_order, id
  `).all(id);
}

export function saveCategory(input: CategoryInput): { id: number } {
  assertCurrentPermission('category_management');
  const categoryName = validateName(input.name, 'Category name');
  const menuId = requiredId(input.menu_id, 'Menu id');
  const sortOrder = validateSortOrder(input.sort_order);
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const database = db();
  if (!database.prepare('SELECT id FROM menus WHERE id = ?').get(menuId)) {
    throw new Error('Menu not found');
  }

  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Category id');
    const result = database.prepare(`
      UPDATE categories SET menu_id = ?, name = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(menuId, categoryName, sortOrder, isActive, id);
    if (result.changes === 0) {
      throw new Error('Category not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'category', entityId: id, details: { menuId, name: categoryName, isActive } });
    return { id };
  }

  const result = database.prepare(`
    INSERT INTO categories (menu_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(menuId, categoryName, sortOrder, isActive);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'category', entityId: id, details: { menuId, name: categoryName } });
  return { id };
}

export function deactivateCategory(idValue: number): void {
  assertCurrentPermission('menu_deactivation');
  const id = requiredId(idValue, 'Category id');
  const database = db();
  const result = database.prepare('UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Category not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'category', entityId: id });
}

export function listMenuItems(categoryId?: number, search = '', includeInactive = false): unknown[] {
  assertCurrentPermission('menu_viewing');
  const conditions: string[] = [];
  const values: Array<number | string> = [];
  if (categoryId !== undefined) {
    conditions.push('category_id = ?');
    values.push(requiredId(categoryId, 'Category id'));
  }
  if (!includeInactive) {
    conditions.push('is_active = 1');
  }
  const trimmedSearch = search.trim();
  if (trimmedSearch) {
    conditions.push('name LIKE ?');
    values.push(`%${trimmedSearch}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db().prepare(`
    SELECT id, category_id, name, price, price_minor, is_veg, is_available, is_active,
           sort_order, tax_name, tax_rate, tax_mode, dietary_label, image_url, created_at, updated_at
    FROM menu_items ${where} ORDER BY sort_order, name, id
  `).all(...values);
}

export function saveMenuItem(input: MenuItemInput): { id: number } {
  assertCurrentPermission(input.id === undefined ? 'menu_creation' : 'menu_editing');
  const categoryId = requiredId(input.category_id, 'Category id');
  const name = validateName(input.name, 'Menu item name');
  const priceMinor = moneyFromInput(input);
  const isVeg = validateBooleanFlag(input.is_veg, 'Vegetarian flag');
  const isAvailable = validateBooleanFlag(input.is_available, 'Availability');
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const sortOrder = validateSortOrder(input.sort_order);
  const taxName = optionalText(input.tax_name, 'Tax name');
  const taxRate = input.tax_rate ?? 0;
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new Error('Tax rate must be between 0 and 100');
  }
  const taxModeValue: unknown = input.tax_mode ?? 'exclusive';
  if (taxModeValue !== 'exclusive' && taxModeValue !== 'inclusive') {
    throw new Error('Tax mode must be exclusive or inclusive');
  }
  const taxMode = taxModeValue;
  const dietaryLabel = optionalText(input.dietary_label, 'Dietary label');
  const database = db();
  if (!database.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) {
    throw new Error('Category not found');
  }
  const legacyPrice = fromMinorUnits(priceMinor);

  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Menu item id');
    const result = database.prepare(`
      UPDATE menu_items SET category_id = ?, name = ?, price = ?, price_minor = ?, is_veg = ?,
        is_available = ?, is_active = ?, sort_order = ?, tax_name = ?, tax_rate = ?, tax_mode = ?,
        dietary_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(categoryId, name, legacyPrice, priceMinor, isVeg, isAvailable, isActive, sortOrder, taxName, taxRate, taxMode, dietaryLabel, id);
    if (result.changes === 0) {
      throw new Error('Menu item not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'menu_item', entityId: id, details: { categoryId, name, priceMinor, isActive, isAvailable } });
    return { id };
  }

  const result = database.prepare(`
    INSERT INTO menu_items (category_id, name, price, price_minor, is_veg, is_available, is_active,
      sort_order, tax_name, tax_rate, tax_mode, dietary_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(categoryId, name, legacyPrice, priceMinor, isVeg, isAvailable, isActive, sortOrder, taxName, taxRate, taxMode, dietaryLabel);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'menu_item', entityId: id, details: { categoryId, name, priceMinor } });
  return { id };
}

export function deactivateMenuItem(idValue: number): void {
  assertCurrentPermission('menu_deactivation');
  const id = requiredId(idValue, 'Menu item id');
  const database = db();
  const result = database.prepare('UPDATE menu_items SET is_active = 0, is_available = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Menu item not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'menu_item', entityId: id });
}

export function setMenuItemAvailability(idValue: number, availableValue: number | boolean): void {
  assertCurrentPermission('menu_editing');
  const id = requiredId(idValue, 'Menu item id');
  const available = validateBooleanFlag(availableValue, 'Availability');
  const database = db();
  const result = database.prepare('UPDATE menu_items SET is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1').run(available, id);
  if (result.changes === 0) {
    throw new Error('Active menu item not found');
  }
  writeAuditLog(database, { action: 'availability', entityType: 'menu_item', entityId: id, details: { available } });
}

export function listVariants(menuItemId: number, includeInactive = false): unknown[] {
  assertCurrentPermission('menu_viewing');
  const id = requiredId(menuItemId, 'Menu item id');
  const activeClause = includeInactive ? '' : ' AND is_active = 1';
  return db().prepare(`
    SELECT id, menu_item_id, name, price_minor, is_active, sort_order, created_at, updated_at
    FROM menu_item_variants WHERE menu_item_id = ?${activeClause} ORDER BY sort_order, name, id
  `).all(id);
}

export function saveVariant(input: VariantInput): { id: number } {
  assertCurrentPermission('variant_management');
  const menuItemId = requiredId(input.menu_item_id, 'Menu item id');
  const name = validateName(input.name, 'Variant name');
  const priceMinor = moneyFromInput(input);
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const sortOrder = validateSortOrder(input.sort_order);
  const database = db();
  if (!database.prepare('SELECT id FROM menu_items WHERE id = ?').get(menuItemId)) {
    throw new Error('Menu item not found');
  }
  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Variant id');
    const result = database.prepare(`
      UPDATE menu_item_variants SET menu_item_id = ?, name = ?, price_minor = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(menuItemId, name, priceMinor, isActive, sortOrder, id);
    if (result.changes === 0) {
      throw new Error('Variant not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'menu_item_variant', entityId: id, details: { menuItemId, name, priceMinor, isActive } });
    return { id };
  }
  const result = database.prepare(`
    INSERT INTO menu_item_variants (menu_item_id, name, price_minor, is_active, sort_order) VALUES (?, ?, ?, ?, ?)
  `).run(menuItemId, name, priceMinor, isActive, sortOrder);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'menu_item_variant', entityId: id, details: { menuItemId, name, priceMinor } });
  return { id };
}

export function deactivateVariant(idValue: number): void {
  assertCurrentPermission('variant_management');
  const id = requiredId(idValue, 'Variant id');
  const database = db();
  const result = database.prepare('UPDATE menu_item_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Variant not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'menu_item_variant', entityId: id });
}

export function listModifierGroups(includeInactive = false): unknown[] {
  assertCurrentPermission('menu_viewing');
  const activeClause = includeInactive ? '' : ' WHERE is_active = 1';
  return db().prepare(`
    SELECT id, name, selection_type, min_selections, max_selections, is_active, sort_order, created_at, updated_at
    FROM modifier_groups${activeClause} ORDER BY sort_order, name, id
  `).all();
}

export function saveModifierGroup(input: ModifierGroupInput): { id: number } {
  assertCurrentPermission('modifier_management');
  const name = validateName(input.name, 'Modifier group name');
  const selection = validateGroupSelection(input);
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const sortOrder = validateSortOrder(input.sort_order);
  const database = db();
  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Modifier group id');
    const result = database.prepare(`
      UPDATE modifier_groups SET name = ?, selection_type = ?, min_selections = ?, max_selections = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(name, selection.selectionType, selection.minSelections, selection.maxSelections, isActive, sortOrder, id);
    if (result.changes === 0) {
      throw new Error('Modifier group not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'modifier_group', entityId: id, details: { name, isActive } });
    return { id };
  }
  const result = database.prepare(`
    INSERT INTO modifier_groups (name, selection_type, min_selections, max_selections, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, selection.selectionType, selection.minSelections, selection.maxSelections, isActive, sortOrder);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'modifier_group', entityId: id, details: { name } });
  return { id };
}

export function deactivateModifierGroup(idValue: number): void {
  assertCurrentPermission('modifier_management');
  const id = requiredId(idValue, 'Modifier group id');
  const database = db();
  const result = database.prepare('UPDATE modifier_groups SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Modifier group not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'modifier_group', entityId: id });
}

export function listModifiers(groupId: number, includeInactive = false): unknown[] {
  assertCurrentPermission('menu_viewing');
  const id = requiredId(groupId, 'Modifier group id');
  const activeClause = includeInactive ? '' : ' AND is_active = 1';
  return db().prepare(`
    SELECT id, modifier_group_id, name, price_minor, is_active, sort_order, created_at, updated_at
    FROM modifiers WHERE modifier_group_id = ?${activeClause} ORDER BY sort_order, name, id
  `).all(id);
}

export function saveModifier(input: ModifierInput): { id: number } {
  assertCurrentPermission('modifier_management');
  const groupId = requiredId(input.modifier_group_id, 'Modifier group id');
  const name = validateName(input.name, 'Modifier name');
  const priceMinor = moneyFromInput(input);
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const sortOrder = validateSortOrder(input.sort_order);
  const database = db();
  if (!database.prepare('SELECT id FROM modifier_groups WHERE id = ?').get(groupId)) {
    throw new Error('Modifier group not found');
  }
  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Modifier id');
    const result = database.prepare(`
      UPDATE modifiers SET modifier_group_id = ?, name = ?, price_minor = ?, is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(groupId, name, priceMinor, isActive, sortOrder, id);
    if (result.changes === 0) {
      throw new Error('Modifier not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'modifier', entityId: id, details: { groupId, name, priceMinor, isActive } });
    return { id };
  }
  const result = database.prepare(`
    INSERT INTO modifiers (modifier_group_id, name, price_minor, is_active, sort_order) VALUES (?, ?, ?, ?, ?)
  `).run(groupId, name, priceMinor, isActive, sortOrder);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'modifier', entityId: id, details: { groupId, name, priceMinor } });
  return { id };
}

export function deactivateModifier(idValue: number): void {
  assertCurrentPermission('modifier_management');
  const id = requiredId(idValue, 'Modifier id');
  const database = db();
  const result = database.prepare('UPDATE modifiers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Modifier not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'modifier', entityId: id });
}

export function listMenuItemModifierGroups(menuItemId: number): unknown[] {
  assertCurrentPermission('menu_viewing');
  const id = requiredId(menuItemId, 'Menu item id');
  return db().prepare(`
    SELECT g.id, g.name, g.selection_type, g.min_selections, g.max_selections, g.is_active, a.sort_order
    FROM menu_item_modifier_groups a
    JOIN modifier_groups g ON g.id = a.modifier_group_id
    WHERE a.menu_item_id = ? AND g.is_active = 1
    ORDER BY a.sort_order, g.name, g.id
  `).all(id);
}

export function setMenuItemModifierGroups(menuItemIdValue: number, groupIds: number[]): void {
  assertCurrentPermission('modifier_management');
  const menuItemId = requiredId(menuItemIdValue, 'Menu item id');
  if (!Array.isArray(groupIds) || groupIds.some(id => !Number.isInteger(id) || id < 1)) {
    throw new Error('Modifier group ids are invalid');
  }
  const uniqueIds = [...new Set(groupIds)];
  const database = db();
  if (!database.prepare('SELECT id FROM menu_items WHERE id = ?').get(menuItemId)) {
    throw new Error('Menu item not found');
  }
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM menu_item_modifier_groups WHERE menu_item_id = ?').run(menuItemId);
    const insert = database.prepare('INSERT INTO menu_item_modifier_groups (menu_item_id, modifier_group_id, sort_order) VALUES (?, ?, ?)');
    uniqueIds.forEach((groupId, index) => {
      if (!database.prepare('SELECT id FROM modifier_groups WHERE id = ? AND is_active = 1').get(groupId)) {
        throw new Error(`Modifier group ${groupId} not found or inactive`);
      }
      insert.run(menuItemId, groupId, index);
    });
  });
  transaction();
  writeAuditLog(database, { action: 'associate', entityType: 'menu_item', entityId: menuItemId, details: { modifierGroupIds: uniqueIds } });
}

export function listDiningAreas(includeInactive = false): unknown[] {
  assertCurrentPermission('table_viewing');
  const activeClause = includeInactive ? '' : ' WHERE is_active = 1';
  return db().prepare(`
    SELECT id, name, sort_order, is_active, created_at, updated_at
    FROM dining_areas${activeClause} ORDER BY sort_order, name, id
  `).all();
}

export function saveDiningArea(input: DiningAreaInput): { id: number } {
  assertCurrentPermission('dining_area_management');
  const name = validateName(input.name, 'Dining area name');
  const sortOrder = validateSortOrder(input.sort_order);
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const database = db();
  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Dining area id');
    const result = database.prepare('UPDATE dining_areas SET name = ?, sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, sortOrder, isActive, id);
    if (result.changes === 0) {
      throw new Error('Dining area not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'dining_area', entityId: id, details: { name, isActive } });
    return { id };
  }
  const result = database.prepare('INSERT INTO dining_areas (name, sort_order, is_active) VALUES (?, ?, ?)').run(name, sortOrder, isActive);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'dining_area', entityId: id, details: { name } });
  return { id };
}

export function deactivateDiningArea(idValue: number): void {
  assertCurrentPermission('dining_area_management');
  const id = requiredId(idValue, 'Dining area id');
  const database = db();
  const tableCount = database.prepare('SELECT COUNT(*) AS count FROM tables WHERE dining_area_id = ? AND is_active = 1').get(id) as { count: number };
  if (tableCount.count > 0) {
    throw new Error('Move or deactivate tables before deactivating this dining area');
  }
  const result = database.prepare('UPDATE dining_areas SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Dining area not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'dining_area', entityId: id });
}

export function listTables(areaId?: number, includeInactive = false): unknown[] {
  assertCurrentPermission('table_viewing');
  const conditions: string[] = [];
  const values: number[] = [];
  if (areaId !== undefined) {
    conditions.push('dining_area_id = ?');
    values.push(requiredId(areaId, 'Dining area id'));
  }
  if (!includeInactive) {
    conditions.push('is_active = 1');
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return db().prepare(`
    SELECT id, dining_area_id, identifier, name, capacity, status, shape, is_active,
      position_x, position_y, width, height, rotation, section, custom_name, created_at, updated_at
    FROM tables${where} ORDER BY identifier, id
  `).all(...values);
}

export function saveTable(input: TableInput): { id: number } {
  assertCurrentPermission('table_management');
  const areaId = requiredId(input.dining_area_id, 'Dining area id');
  const identifier = validateIdentifier(input.identifier);
  const name = input.name === undefined || input.name === '' ? identifier : validateName(input.name, 'Table name');
  const capacity = validateInteger(input.capacity, 'Capacity', 1);
  const status = validateTableStatus(input.status ?? 'AVAILABLE');
  const shape = validateTableShape(input.shape ?? 'rectangle');
  const isActive = validateBooleanFlag(input.is_active, 'Active state');
  const positionX = validateLayoutPosition(input.position_x, 'X position', 24);
  const positionY = validateLayoutPosition(input.position_y, 'Y position', 24);
  const width = validateLayoutPosition(input.width, 'Width', 132);
  const height = validateLayoutPosition(input.height, 'Height', 88);
  const rotation = validateLayoutPosition(input.rotation, 'Rotation', 0);
  if (width < 48 || height < 40) {
    throw new Error('Table layout size is too small');
  }
  const database = db();
  if (!database.prepare('SELECT id FROM dining_areas WHERE id = ? AND is_active = 1').get(areaId)) {
    throw new Error('Dining area not found or inactive');
  }
  const trimmedName = input.name?.trim();
  const legacySection = trimmedName ?? identifier;
  if (input.id !== undefined) {
    const id = requiredId(input.id, 'Table id');
    const result = database.prepare(`
      UPDATE tables SET dining_area_id = ?, identifier = ?, name = ?, capacity = ?, status = ?, shape = ?,
        is_active = ?, position_x = ?, position_y = ?, width = ?, height = ?, rotation = ?, section = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(areaId, identifier, name, capacity, status, shape, isActive, positionX, positionY, width, height, rotation, legacySection, id);
    if (result.changes === 0) {
      throw new Error('Table not found');
    }
    writeAuditLog(database, { action: 'update', entityType: 'table', entityId: id, details: { areaId, identifier, status, isActive } });
    return { id };
  }
  const result = database.prepare(`
    INSERT INTO tables (dining_area_id, identifier, name, capacity, status, shape, is_active,
      position_x, position_y, width, height, rotation, section, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(areaId, identifier, name, capacity, status, shape, isActive, positionX, positionY, width, height, rotation, legacySection);
  const id = Number(result.lastInsertRowid);
  writeAuditLog(database, { action: 'create', entityType: 'table', entityId: id, details: { areaId, identifier, capacity } });
  return { id };
}

export function deactivateTable(idValue: number): void {
  assertCurrentPermission('table_management');
  const id = requiredId(idValue, 'Table id');
  const database = db();
  const activeOrder = database.prepare("SELECT order_number FROM orders WHERE table_id = ? AND status NOT IN ('COMPLETED','CANCELLED') LIMIT 1").get(id) as { order_number: string } | undefined;
  if (activeOrder) {
    throw new Error(`Cannot deactivate table with an active order (${activeOrder.order_number})`);
  }
  const result = database.prepare('UPDATE tables SET is_active = 0, status = \'DISABLED\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  if (result.changes === 0) {
    throw new Error('Table not found');
  }
  writeAuditLog(database, { action: 'deactivate', entityType: 'table', entityId: id });
}

export function updateTableStatus(idValue: number, statusValue: TableStatus): void {
  assertCurrentPermission('table_status_management');
  const id = requiredId(idValue, 'Table id');
  const status = validateTableStatus(statusValue);
  const database = db();
  const result = database.prepare('UPDATE tables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1').run(status, id);
  if (result.changes === 0) {
    throw new Error('Active table not found');
  }
  writeAuditLog(database, { action: 'status', entityType: 'table', entityId: id, details: { status } });
}

export function updateTableLayout(input: {
  id: number;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: TableShape;
}): void {
  assertCurrentPermission('floor_layout_management');
  const id = requiredId(input.id, 'Table id');
  const database = db();
  const current = database.prepare('SELECT position_x, position_y, width, height, rotation, shape FROM tables WHERE id = ? AND is_active = 1').get(id) as {
    position_x: number; position_y: number; width: number; height: number; rotation: number; shape: TableShape;
  } | undefined;
  if (!current) {
    throw new Error('Active table not found');
  }
  const positionX = validateLayoutPosition(input.position_x, 'X position', current.position_x);
  const positionY = validateLayoutPosition(input.position_y, 'Y position', current.position_y);
  const width = validateLayoutPosition(input.width, 'Width', current.width);
  const height = validateLayoutPosition(input.height, 'Height', current.height);
  const rotation = validateLayoutPosition(input.rotation, 'Rotation', current.rotation);
  const shape = input.shape === undefined ? current.shape : validateTableShape(input.shape);
  if (width < 48 || height < 40) {
    throw new Error('Table layout size is too small');
  }
  database.prepare(`
    UPDATE tables SET position_x = ?, position_y = ?, width = ?, height = ?, rotation = ?, shape = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(positionX, positionY, width, height, rotation, shape, id);
  writeAuditLog(database, { action: 'layout', entityType: 'table', entityId: id, details: { positionX, positionY, width, height, rotation, shape } });
}

export function listStage2AuditLogs(limit = 100): unknown[] {
  assertCurrentPermission('audit_view');
  const database = db();
  return database.prepare(`
    SELECT id, action, entity_type, entity_id, actor_role, details, created_at
    FROM audit_logs ORDER BY id DESC LIMIT ?
  `).all(Math.min(Math.max(Math.trunc(limit), 1), 500));
}
