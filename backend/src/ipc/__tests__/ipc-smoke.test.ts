/**
 * IPC smoke coverage.
 *
 * Registers every IPC handler exactly as the main process does, then invokes
 * each channel against a real migrated SQLite database. Handlers are allowed to
 * return validation failures (`{ success: false, error }`) — what this test
 * guards against is a handler blowing up with an infrastructure-level fault:
 * bad SQL (`no such column/table`), a missing binding, or an unhandled throw.
 *
 * This is the regression net for "the app builds fine but a screen errors at
 * runtime" class of bugs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, setupSettings, resetAuth, teardown, seedMinimalMenu, seedTable, seedCustomer } from '../../test/helpers';
import { ipcMain } from 'electron';

type Handler = (event: unknown, payload?: unknown) => unknown;

const handlers = new Map<string, Handler>();

// The shared electron mock exposes ipcMain.handle as a no-op; capture instead.
(ipcMain as unknown as { handle: (channel: string, fn: Handler) => void }).handle = (channel, fn) => {
  handlers.set(channel, fn);
};

const FATAL_PATTERNS = [
  /no such column/i,
  /no such table/i,
  /has no column named/i,
  /syntax error/i,
  /wrong number of/i,
  /is not a function/i,
  /cannot read propert/i,
  /undefined is not/i,
  /too few parameter values/i,
  /too many parameter values/i,
];

function fatalError(channel: string, result: unknown): string | null {
  if (result && typeof result === 'object' && 'error' in result) {
    const rawError = (result as { error?: unknown }).error;
    const error = typeof rawError === 'string' ? rawError : '';
    if (FATAL_PATTERNS.some(pattern => pattern.test(error))) {
      return `${channel}: ${error}`;
    }
  }
  return null;
}

function assertNoFatalErrors(failures: string[]): void {
  expect(failures, `infrastructure errors:\n${failures.join('\n')}`).toEqual([]);
}

let db: Database.Database;
let menuItemId = 0;
let tableId = 0;
let customerId = 0;
let orderId = 0;

describe('IPC smoke: every registered channel', () => {
  beforeAll(async () => {
    db = createTestDb();
    setupSettings({ tax_enabled: true, tax_name: 'Sales Tax', tax_rate: 15, tax_mode: 'exclusive' });
    resetAuth();

    const seeded = seedMinimalMenu(db);
    menuItemId = seeded.menuItemId;
    tableId = seedTable(db, 'Smoke-1');
    customerId = seedCustomer(db, 'Smoke Customer', '03001112233');
    db.prepare("INSERT INTO staff (name, role, pin_hash, is_active) VALUES ('Smoke Admin', 'admin', 'x', 1)").run();

    // Register every IPC surface, mirroring backend/src/main.ts.
    const modules = await Promise.all([
      import('../orders'), import('../menu'), import('../tables'), import('../billing'),
      import('../inventory'), import('../staff'), import('../reports'), import('../backup'),
      import('../settings'), import('../printer'), import('../kds'), import('../cash'),
      import('../expenses'), import('../customers'), import('../dashboard'),
      import('../business-session'), import('../system'), import('../payments'),
      import('../stage2'), import('../suppliers'), import('../audit'),
    ]);
    for (const mod of modules) {
      for (const exported of Object.values(mod)) {
        if (typeof exported === 'function' && exported.name.startsWith('register')) {
          (exported as () => void)();
        }
      }
    }

    const created = await invoke('orders:create', { tableId, covers: 2, type: 'dine-in' }) as { success: boolean; data?: { id: number } };
    orderId = created.data?.id ?? 0;
    await invoke('orders:addItems', { orderId, items: [{ menu_item_id: menuItemId, qty: 1 }] });
  });

  afterAll(() => {
    teardown();
  });

  async function invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = handlers.get(channel);
    if (!handler) { throw new Error(`No handler registered for ${channel}`); }
    return await handler({}, payload);
  }

  it('registers the full channel surface', () => {
    expect(handlers.size).toBeGreaterThan(100);
  });

  it('read-only channels execute without infrastructure errors', async () => {
    const readChannels: Array<[string, unknown?]> = [
      ['orders:getOpen'],
      ['orders:getDraft'],
      ['orders:getById', { orderId }],
      ['orders:getByTable', { tableId }],
      ['menu:getMenus'],
      ['menu:getAll'],
      ['menu:getRecipe', { menuItemId }],
      ['tables:getAll'],
      ['kds:getActiveTickets'],
      ['inventory:getAll'],
      ['inventory:getLowStock'],
      ['inventory:getMovements', {}],
      ['staff:getAll'],
      ['shifts:getActive'],
      ['shifts:list', {}],
      ['expenses:getAll', {}],
      ['expenses:getCategories'],
      ['customers:getAll'],
      ['customers:getById', customerId],
      ['customers:search', 'Smoke'],
      ['customers:getHistory', customerId],
      ['dashboard:getMetrics', { filter: 'today' }],
      ['businessSession:getActive'],
      ['settings:get'],
      ['system:isSetupComplete'],
      ['billing:getBill', { orderId }],
      ['suppliers:list', {}],
      ['purchases:list', {}],
      ['audit:list', {}],
      ['stage2:categories:list', {}],
      ['stage2:menu-items:list', {}],
      ['stage2:variants:list', { menuItemId }],
      ['stage2:modifier-groups:list', {}],
      ['stage2:modifiers:list', { modifierGroupId: 1 }],
      ['stage2:menu-item-modifier-groups:list', menuItemId],
      ['stage2:dining-areas:list', {}],
      ['stage2:tables:list', {}],
      ['stage2:audit:list', 10],
      ['backup:getAutoBackupConfig'],
      ['auth:check', { permission: 'reports.view' }],
    ];

    const failures: string[] = [];
    for (const [channel, payload] of readChannels) {
      const failure = fatalError(channel, await invoke(channel, payload));
      if (failure) { failures.push(failure); }
    }
    assertNoFatalErrors(failures);
  });

  it('every report channel executes against a real database', async () => {
    const range = { filter: 'daily', start: '2020-01-01', end: '2999-01-01' };
    const reportChannels: Array<[string, unknown?]> = [
      ['reports:daily', range],
      ['reports:sales', range],
      ['reports:products', range],
      ['reports:categories', range],
      ['reports:modifiers', range],
      ['reports:tables', range],
      ['reports:kitchen', range],
      ['reports:inventory', range],
      ['reports:expenses', range],
      ['reports:gst', range],
      ['reports:tax', range],
      ['reports:getPastOrders', { filter: 'daily', page: 1, limit: 10 }],
    ];

    const failures: string[] = [];
    for (const [channel, payload] of reportChannels) {
      const failure = fatalError(channel, await invoke(channel, payload));
      if (failure) { failures.push(failure); }
    }
    assertNoFatalErrors(failures);
  });

  it('write channels execute without infrastructure errors', async () => {
    const writeChannels: Array<[string, unknown?]> = [
      ['orders:updateType', { orderId, type: 'takeaway' }],
      ['orders:applyDiscount', { orderId, discount: { type: 'PERCENT', percent: 5, minor: 0 } }],
      ['orders:updateCustomer', { orderId, customerId }],
      ['orders:sendKOT', { orderId }],
      ['tables:upsert', { name: 'Smoke-2', capacity: 4, section: 'Main' }],
      ['menu:upsertCategory', { name: 'Smoke Category', sort_order: 9 }],
      ['inventory:adjust', { item_id: 1, type: 'adjustment', qty_change: 1, note: 'smoke' }],
      ['expenses:create', { date: '2026-01-01', category: 'Misc', amount: 10, description: 'smoke' }],
      ['customers:create', { name: 'Smoke Two', phone: '03004445566' }],
      ['suppliers:save', { name: 'Smoke Supplier' }],
      ['stage2:categories:save', { name: 'Smoke S2 Category' }],
      ['stage2:dining-areas:save', { name: 'Smoke Area' }],
      ['stage2:modifier-groups:save', { name: 'Smoke Group', selection_type: 'multiple' }],
    ];

    const failures: string[] = [];
    for (const [channel, payload] of writeChannels) {
      const failure = fatalError(channel, await invoke(channel, payload));
      if (failure) { failures.push(failure); }
    }
    assertNoFatalErrors(failures);
  });

  it('a full order → KOT → bill lifecycle lands in the reports', async () => {
    const created = await invoke('orders:create', { tableId: seedTable(db, 'Smoke-Lifecycle'), covers: 2, type: 'dine-in' }) as { success: boolean; data?: { id: number } };
    const lifecycleOrderId = created.data?.id ?? 0;
    expect(lifecycleOrderId).toBeGreaterThan(0);

    const added = await invoke('orders:addItems', { orderId: lifecycleOrderId, items: [{ menu_item_id: menuItemId, qty: 2 }] }) as { success: boolean; error?: string };
    expect(added.success, added.error).toBe(true);

    const kot = await invoke('orders:sendKOT', { orderId: lifecycleOrderId }) as { success: boolean; error?: string };
    expect(kot.success, kot.error).toBe(true);

    const order = db.prepare('SELECT total_minor FROM orders WHERE id = ?').get(lifecycleOrderId) as { total_minor: number };
    expect(order.total_minor).toBeGreaterThan(0);

    const billed = await invoke('billing:createBill', {
      orderId: lifecycleOrderId,
      payments: [{ method: 'cash', amount: order.total_minor / 100 }],
    }) as { success: boolean; error?: string; data?: { total_amount_minor: number; payment_status: string } };
    expect(billed.success, billed.error).toBe(true);
    expect(billed.data?.payment_status).toBe('PAID');

    // The discount column added by migration 022 must be readable by the
    // sales report — this query used to fail with "no such column".
    const sales = await invoke('reports:sales', { filter: 'daily' }) as {
      success: boolean; error?: string; data?: { totalOrders: number; grossSales: number; totalDiscount: number; paymentBreakdown: Record<string, number> };
    };
    expect(sales.success, sales.error).toBe(true);
    expect(sales.data?.totalOrders).toBeGreaterThan(0);
    expect(sales.data?.grossSales).toBeGreaterThan(0);
    expect(sales.data?.paymentBreakdown.cash).toBeGreaterThan(0);

    // Range-filtered reports bind their date parameters (they previously threw
    // "Too few parameter values were provided").
    const products = await invoke('reports:products', { filter: 'daily' }) as { success: boolean; error?: string; data?: Array<{ qty: number }> };
    expect(products.success, products.error).toBe(true);
    expect((products.data ?? []).length).toBeGreaterThan(0);

    for (const channel of ['reports:categories', 'reports:tables', 'reports:kitchen', 'reports:modifiers']) {
      const result = await invoke(channel, { filter: 'daily' }) as { success: boolean; error?: string };
      expect(result.success, `${channel}: ${result.error ?? ''}`).toBe(true);
    }
  });

  it('shift, cash, purchasing, KDS and customer-credit flows execute end to end', async () => {
    // ── Business session + shift ───────────────────────────────────────
    const session = await invoke('businessSession:start', { staffId: 1, notes: 'smoke' }) as { success: boolean; error?: string };
    expect(session.success, session.error).toBe(true);

    const shift = await invoke('shifts:open', { staffId: 1, openingCash: 5000 }) as { success: boolean; error?: string; data?: { id: number } };
    expect(shift.success, shift.error).toBe(true);
    const shiftId = shift.data?.id ?? 0;

    const cashEntry = await invoke('shifts:addCashEntry', { shiftId, type: 'CASH_IN', amount: 250, note: 'float top-up' }) as { success: boolean; error?: string };
    expect(cashEntry.success, cashEntry.error).toBe(true);

    const entries = await invoke('shifts:getCashEntries', { shiftId }) as { success: boolean; error?: string; data?: unknown[] };
    expect(entries.success, entries.error).toBe(true);
    expect((entries.data ?? []).length).toBeGreaterThan(0);

    const totals = await invoke('shifts:getTotals', { openedAt: '2020-01-01 00:00:00' }) as { success: boolean; error?: string };
    expect(totals.success, totals.error).toBe(true);

    // ── Purchasing ─────────────────────────────────────────────────────
    const supplier = await invoke('suppliers:save', { name: 'Smoke Wholesaler', phone: '03007778899' }) as { success: boolean; error?: string; data?: { id: number } };
    expect(supplier.success, supplier.error).toBe(true);

    const inventoryItemId = (db.prepare('SELECT id FROM inventory_items ORDER BY id LIMIT 1').get() as { id: number }).id;
    const purchase = await invoke('purchases:create', {
      supplier_id: supplier.data?.id,
      items: [{ inventory_item_id: inventoryItemId, qty: 10, unit_cost: 45 }],
    }) as { success: boolean; error?: string; data?: { id: number } };
    expect(purchase.success, purchase.error).toBe(true);

    const received = await invoke('purchases:receive', { purchaseId: purchase.data?.id }) as { success: boolean; error?: string };
    expect(received.success, received.error).toBe(true);

    // ── KDS ────────────────────────────────────────────────────────────
    const tickets = await invoke('kds:getActiveTickets') as { success: boolean; error?: string; data?: Array<{ id: number; items?: Array<{ id: number }> }> };
    expect(tickets.success, tickets.error).toBe(true);

    // ── Customer credit (unpaid balance settled later) ─────────────────
    const creditTableId = seedTable(db, 'Smoke-Credit');
    const creditOrder = await invoke('orders:create', { tableId: creditTableId, type: 'dine-in' }) as { success: boolean; data?: { id: number } };
    const creditOrderId = creditOrder.data?.id ?? 0;
    await invoke('orders:addItems', { orderId: creditOrderId, items: [{ menu_item_id: menuItemId, qty: 1 }] });
    const creditTotal = (db.prepare('SELECT total_minor FROM orders WHERE id = ?').get(creditOrderId) as { total_minor: number }).total_minor;

    const creditBill = await invoke('billing:createBill', {
      orderId: creditOrderId,
      payments: [{ method: 'unpaid', amount: creditTotal / 100 }],
      customerId,
    }) as { success: boolean; error?: string };
    expect(creditBill.success, creditBill.error).toBe(true);

    const settled = await invoke('customers:settleBalance', { customerId, amount: creditTotal / 100, method: 'cash' }) as { success: boolean; error?: string };
    expect(settled.success, settled.error).toBe(true);

    const outstanding = (db.prepare('SELECT outstanding_balance FROM customers WHERE id = ?').get(customerId) as { outstanding_balance: number }).outstanding_balance;
    expect(Math.round(outstanding * 100)).toBe(0);

    // ── Close the shift ────────────────────────────────────────────────
    const closed = await invoke('shifts:close', { shiftId, closingCash: 5250, staffId: 1 }) as { success: boolean; error?: string };
    expect(closed.success, closed.error).toBe(true);
  });

  it('handlers never reject — every failure is a structured response', async () => {
    for (const [channel, handler] of handlers) {
      // Printing and dialog-driven channels are skipped: they touch hardware
      // or the OS file picker, neither of which exists in a test runner.
      if (channel.startsWith('print:') || channel.includes('upload') || channel.includes('backup:') || channel.includes('factoryReset')) { continue; }
      let result: unknown;
      try {
        result = await handler({}, undefined);
      } catch (e) {
        throw new Error(`${channel} threw instead of returning a structured error`, { cause: e });
      }
      expect(result, `${channel} must return a structured response`).toBeTypeOf('object');
    }
  });
});
