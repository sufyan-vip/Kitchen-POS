import { describe, expect, it } from 'vitest';
import {
  validateBooleanFlag,
  validateGroupSelection,
  validateIdentifier,
  validateLayoutPosition,
  validateMoneyMinor,
  validateName,
  validateTableStatus,
} from './stage2-validation';

describe('Stage 2 validation', () => {
  it('normalizes names and rejects blank or oversized values', () => {
    expect(validateName('  Breakfast  ', 'Category name')).toBe('Breakfast');
    expect(() => { validateName('   ', 'Category name'); }).toThrow('Category name is required');
    expect(() => { validateName('x'.repeat(121)); }).toThrow('120 characters or fewer');
  });

  it('uses safe PKR minor units for prices', () => {
    expect(validateMoneyMinor('125.50')).toBe(12550);
    expect(validateMoneyMinor(0.1 + 0.2)).toBe(30);
    expect(() => { validateMoneyMinor('-1', 'Price'); }).toThrow('non-negative');
    expect(() => { validateMoneyMinor('12.34567', 'Price'); }).toThrow('Invalid monetary amount');
  });

  it('validates modifier selection rules', () => {
    expect(validateGroupSelection({ selection_type: 'single', min_selections: 0, max_selections: 9 })).toEqual({
      selectionType: 'single', minSelections: 0, maxSelections: 1,
    });
    expect(() => { validateGroupSelection({ selection_type: 'multiple', min_selections: 3, max_selections: 2 }); }).toThrow('Maximum selections');
  });

  it('validates flags, table identifiers, statuses, and layout values', () => {
    expect(validateBooleanFlag(true, 'Active')).toBe(1);
    expect(validateBooleanFlag(false, 'Active')).toBe(0);
    expect(validateIdentifier('T-01')).toBe('T-01');
    expect(validateTableStatus('RESERVED')).toBe('RESERVED');
    expect(validateLayoutPosition('48.25', 'X position', 0)).toBe(48.3);
    expect(() => { validateTableStatus('BUSY'); }).toThrow('Status must be one of');
    expect(() => { validateLayoutPosition(-1, 'X position', 0); }).toThrow('between 0 and 10000');
  });
});
