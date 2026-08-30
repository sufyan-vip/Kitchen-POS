import { toMinorUnits } from './money';

export const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'DISABLED'] as const;
export type TableStatus = typeof TABLE_STATUSES[number];
export const TABLE_SHAPES = ['rectangle', 'round'] as const;
export type TableShape = typeof TABLE_SHAPES[number];
export const SELECTION_TYPES = ['single', 'multiple'] as const;
export type SelectionType = typeof SELECTION_TYPES[number];

const MAX_NAME_LENGTH = 120;

export function validateName(value: unknown, field = 'Name'): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} is required`);
  }
  const name = value.trim();
  if (!name) {
    throw new Error(`${field} is required`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`${field} must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return name;
}

export function validateIdentifier(value: unknown): string {
  const identifier = validateName(value, 'Table identifier');
  if (identifier.length > 40) {
    throw new Error('Table identifier must be 40 characters or fewer');
  }
  return identifier;
}

export function validateInteger(value: unknown, field: string, minimum = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${field} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

export function validateMoneyMinor(value: unknown, field = 'Price'): number {
  const minor = toMinorUnits(value as number | string);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`${field} must be a non-negative safe monetary amount`);
  }
  return minor;
}

export function validateOptionalMoneyMinor(value: unknown, field = 'Price'): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  return validateMoneyMinor(value, field);
}

export function validateSortOrder(value: unknown): number {
  return validateInteger(value ?? 0, 'Sort order', 0);
}

export function validateBooleanFlag(value: unknown, field: string, fallback = 1): 0 | 1 {
  const normalized = value === undefined ? fallback : value;
  if (normalized === true || normalized === 1 || normalized === '1') {
    return 1;
  }
  if (normalized === false || normalized === 0 || normalized === '0') {
    return 0;
  }
  throw new Error(`${field} must be 0 or 1`);
}

export function validateTableStatus(value: unknown): TableStatus {
  if (typeof value !== 'string' || !(TABLE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(`Status must be one of: ${TABLE_STATUSES.join(', ')}`);
  }
  return value as TableStatus;
}

export function validateTableShape(value: unknown): TableShape {
  if (typeof value !== 'string' || !(TABLE_SHAPES as readonly string[]).includes(value)) {
    throw new Error(`Shape must be one of: ${TABLE_SHAPES.join(', ')}`);
  }
  return value as TableShape;
}

export function validateSelectionType(value: unknown): SelectionType {
  if (typeof value !== 'string' || !(SELECTION_TYPES as readonly string[]).includes(value)) {
    throw new Error('Selection type must be single or multiple');
  }
  return value as SelectionType;
}

export interface ValidatedGroupSelection {
  selectionType: SelectionType;
  minSelections: number;
  maxSelections: number | null;
}

export function validateGroupSelection(payload: {
  selection_type?: unknown;
  min_selections?: unknown;
  max_selections?: unknown;
}): ValidatedGroupSelection {
  const selectionType = validateSelectionType(payload.selection_type ?? 'multiple');
  const minSelections = validateInteger(payload.min_selections ?? 0, 'Minimum selections', 0);
  const rawMax = payload.max_selections === '' || payload.max_selections === undefined || payload.max_selections === null
    ? null
    : validateInteger(payload.max_selections, 'Maximum selections', 0);
  const maxSelections = selectionType === 'single' ? 1 : rawMax;
  if (maxSelections !== null && maxSelections < minSelections) {
    throw new Error('Maximum selections cannot be less than minimum selections');
  }
  return { selectionType, minSelections, maxSelections };
}

export function validateLayoutPosition(value: unknown, field: string, fallback: number): number {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
    throw new Error(`${field} must be between 0 and 10000`);
  }
  return Math.round(parsed * 10) / 10;
}
