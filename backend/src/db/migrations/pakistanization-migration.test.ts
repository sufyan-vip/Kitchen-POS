import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Pakistanization migration', () => {
  it('preserves legacy data while adding configurable tax/payment columns', () => {
    const sql = fs.readFileSync(path.join(__dirname, '014_pakistanization.sql'), 'utf8');
    expect(sql).toContain('payments_legacy_014');
    expect(sql).toContain('payment_methods');
    expect(sql).toContain('jazzcash');
    expect(sql).toContain('easypaisa');
    expect(sql).toContain('transaction_reference');
    expect(sql).toContain('tax_amount_minor');
    expect(sql).toContain('Legacy GST');
  });
});
