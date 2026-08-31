import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mockElectron, createTestDb, resetAuth, seedTable, setupSettings, teardown } from '../test/helpers';

mockElectron();

import { deactivateTable } from './stage2';
import { createOrder } from './order-service';
import { resetRecoveryRateLimit } from '../ipc/system';
import { assertCurrentPermission, setCurrentRole } from './authz';
import { getPurchaseItems } from './suppliers';

describe('Production Readiness Pass Regression Tests', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
    resetAuth();
    setupSettings();
    resetRecoveryRateLimit();
  });

  afterEach(() => {
    teardown();
  });

  it('prevents deactivating a table when an active open order exists on it', () => {
    const tableId = seedTable(db, 'T-Active');
    const order = createOrder({ tableId, type: 'dine-in', status: 'OPEN' });
    expect(order.order_number).toBeTruthy();

    expect(() => { deactivateTable(tableId); }).toThrow(/Cannot deactivate table with an active order/);
  });

  it('enforces permission checks on purchasing and supplier operations', () => {
    setCurrentRole('waiter'); // Waiter lacks purchasing_view
    expect(() => { getPurchaseItems(1); }).toThrow(/Permission denied: purchasing_view/);

    setCurrentRole('admin');
    expect(() => { getPurchaseItems(1); }).not.toThrow();
  });

  it('enforces permission checks across authz helper', () => {
    setCurrentRole('kitchen');
    expect(() => { assertCurrentPermission('staff'); }).toThrow(/Permission denied: staff/);
    expect(() => { assertCurrentPermission('kot_view'); }).not.toThrow();
  });
});
