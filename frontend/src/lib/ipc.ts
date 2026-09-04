import { Category, MenuItem, InventoryItem, Order, OrderItem, KDSTicket, Shift, RecipeItem, Table, Expense, Staff, BusinessSession, AutoBackupConfig, BackupReminderConfig, Stage2Category, Stage2MenuItem, MenuItemVariant, ModifierGroup, Modifier, DiningArea, Stage2Table, Stage2TableStatus, Stage2TableShape, OrderLineInput, SendKOTResult, Supplier, Purchase, PurchaseItem } from '../types/models';

export interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type KDSOrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type KDSItemStatus = 'pending' | 'preparing' | 'ready' | 'served';

const ipcApi = (window as unknown as { api: unknown }).api;

const mockApi = {
  orders: {
    create: () => Promise.resolve({ success: true, data: { id: 1, order_number: 'ORD-000001' } }),
    addItems: () => Promise.resolve({ success: true, data: { added: 0, order: {} } }),
    updateItemQty: () => Promise.resolve({ success: true }),
    updateItemNote: () => Promise.resolve({ success: true }),
    voidItem: () => Promise.resolve({ success: true }),
    getOpen: () => Promise.resolve({ success: true, data: [] }),
    getDraft: () => Promise.resolve({ success: true, data: null }),
    discardDraft: () => Promise.resolve({ success: true }),
    getById: () => Promise.resolve({ success: true, data: null }),
    getByTable: () => Promise.resolve({ success: true, data: null }),
    sendKOT: () => Promise.resolve({ success: true, data: { kotId: 1, kotNumber: 1, orderId: 1, orderNumber: 'ORD-000001', kotType: 'MAIN', items: [] } }),
    updateStatus: () => Promise.resolve({ success: true }),
    updateType: () => Promise.resolve({ success: true }),
    applyDiscount: () => Promise.resolve({ success: true }),
    changeTable: () => Promise.resolve({ success: true }),
    cancelOrder: () => Promise.resolve({ success: true }),
    updateCustomer: () => Promise.resolve({ success: true }),
  },
  kds: {
    getActiveTickets: () => Promise.resolve({ success: true, data: [] }),
    updateItemStatus: () => Promise.resolve({ success: true }),
    updateKotStatus: () => Promise.resolve({ success: true }),
    updateOrderStatus: () => Promise.resolve({ success: true }),
  },
  menu: {
    getMenus: () => Promise.resolve({ success: true, data: [{ id: 1, name: 'Main Menu', is_active: 1, is_default: 1 }] }),
    upsertMenu: () => Promise.resolve({ success: true, data: { id: 999 } }),
    duplicateMenu: () => Promise.resolve({ success: true, data: { id: 999 } }),
    uploadImage: () => Promise.resolve({ success: true, data: 'file:///tmp/img.png' }),
    getAll: () => Promise.resolve({
      success: true,
      data: [
        {
          id: 1, name: 'Starters', sort_order: 1, is_active: 1,
          items: [
            { id: 101, category_id: 1, name: 'Chicken Burger', price: 850, is_veg: 0, is_available: 1, cgst_rate: 0, sgst_rate: 0, hsn_code: null, tax_rate: 0 },
            { id: 102, category_id: 1, name: 'Fries', price: 300, is_veg: 0, is_available: 1, cgst_rate: 0, sgst_rate: 0, hsn_code: null, tax_rate: 0 },
          ]
        },
        {
          id: 2, name: 'Main Course', sort_order: 2, is_active: 1,
          items: [
            { id: 201, category_id: 2, name: 'Chicken Karahi', price: 1600, is_veg: 0, is_available: 1, cgst_rate: 0, sgst_rate: 0, hsn_code: null, tax_rate: 0 },
            { id: 202, category_id: 2, name: 'Beef Biryani', price: 550, is_veg: 0, is_available: 1, cgst_rate: 0, sgst_rate: 0, hsn_code: null, tax_rate: 0 },
          ]
        },
        {
          id: 3, name: 'Breads', sort_order: 3, is_active: 1,
          items: [
            { id: 301, category_id: 3, name: 'Naan', price: 60, is_veg: 0, is_available: 1, cgst_rate: 0, sgst_rate: 0, hsn_code: null, tax_rate: 0 },
            { id: 302, category_id: 3, name: 'Soft Drink', price: 150, is_veg: 0, is_available: 1, cgst_rate: 0, sgst_rate: 0, hsn_code: null, tax_rate: 0 },
          ]
        }
      ]
    }),
    upsertItem: () => Promise.resolve({ success: true, data: { id: 999 } }),
    deleteItem: () => Promise.resolve({ success: true }),
    toggleAvailable: () => Promise.resolve({ success: true }),
    upsertCategory: () => Promise.resolve({ success: true, data: { id: 99 } }),
    deleteCategory: () => Promise.resolve({ success: true }),
    getRecipe: () => Promise.resolve({ success: true, data: [] }),
    updateRecipe: () => Promise.resolve({ success: true }),
  },
  tables: {
    getAll: () => Promise.resolve({
      success: true,
      data: [
        { id: 1, name: 'Table 1', capacity: 4, section: 'Main' },
        { id: 2, name: 'Table 2', capacity: 2, section: 'Main' },
        { id: 3, name: 'Table 3', capacity: 6, section: 'Outdoor' },
      ]
    }),
    upsert: () => Promise.resolve({ success: true }),
    delete: () => Promise.resolve({ success: true }),
    updateCustomName: () => Promise.resolve({ success: true }),
  },
  stage2: {
    categories: {
      list: () => Promise.resolve({ success: true, data: [] as Stage2Category[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
    },
    menuItems: {
      list: () => Promise.resolve({ success: true, data: [] as Stage2MenuItem[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
      setAvailability: () => Promise.resolve({ success: true }),
    },
    variants: {
      list: () => Promise.resolve({ success: true, data: [] as MenuItemVariant[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
    },
    modifierGroups: {
      list: () => Promise.resolve({ success: true, data: [] as ModifierGroup[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
    },
    modifiers: {
      list: () => Promise.resolve({ success: true, data: [] as Modifier[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
    },
    menuItemModifierGroups: {
      list: () => Promise.resolve({ success: true, data: [] as ModifierGroup[] }),
      set: () => Promise.resolve({ success: true }),
    },
    diningAreas: {
      list: () => Promise.resolve({ success: true, data: [] as DiningArea[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
    },
    tables: {
      list: () => Promise.resolve({ success: true, data: [] as Stage2Table[] }),
      save: () => Promise.resolve({ success: true, data: { id: 1 } }),
      deactivate: () => Promise.resolve({ success: true }),
      updateStatus: () => Promise.resolve({ success: true }),
      updateLayout: () => Promise.resolve({ success: true }),
    },
    audit: {
      list: () => Promise.resolve({ success: true, data: [] }),
    },
  },
  payments: {
    updateStatus: () => Promise.resolve({ success: true }),
    verify: () => Promise.resolve({ success: true }),
  },
  billing: {
    createBill: () => Promise.resolve({ success: true }),
    getBill: () => Promise.resolve({ success: true, data: {} }),
  },
  print: {
    kot: () => Promise.resolve({ success: true }),
    bill: () => Promise.resolve({ success: true }),
  },
  inventory: {
    getAll: () => Promise.resolve({ success: true, data: [] }),
    getLowStock: () => Promise.resolve({ success: true, data: [] }),
    getMovements: () => Promise.resolve({ success: true, data: [] }),
    convert: () => Promise.resolve({ success: true, data: 0 }),
    adjust: () => Promise.resolve({ success: true }),
    upsertItem: () => Promise.resolve({ success: true }),
    updateRecipe: () => Promise.resolve({ success: true }),
  },
  suppliers: {
    list: () => Promise.resolve({ success: true, data: [] as Supplier[] }),
    save: () => Promise.resolve({ success: true, data: { id: 1 } }),
  },
  purchases: {
    list: () => Promise.resolve({ success: true, data: [] as Purchase[] }),
    items: () => Promise.resolve({ success: true, data: [] as PurchaseItem[] }),
    create: () => Promise.resolve({ success: true, data: { id: 1, purchase_number: 'PO-000001' } }),
    receive: () => Promise.resolve({ success: true }),
    cancel: () => Promise.resolve({ success: true }),
  },
  audit: {
    list: () => Promise.resolve({ success: true, data: [] }),
  },
  staff: {
    login: (payload: { pin: string }) => {
      if (payload.pin === '1234') {
        return Promise.resolve({ success: true, data: { id: 1, name: 'Mock Admin', role: 'admin' } });
      }
      return Promise.resolve({ success: false, error: 'Invalid PIN' });
    },
    logout: () => Promise.resolve({ success: true }),
    getAll: () => Promise.resolve({ success: true, data: [] }),
    upsert: () => Promise.resolve({ success: true, data: { id: 2 } }),
    delete: () => Promise.resolve({ success: true }),
    changePin: () => Promise.resolve({ success: true }),
  },
  shifts: (() => {
    let activeShift: Shift | null = null;
    return {
      getActive: () => Promise.resolve({ success: true, data: activeShift }),
      open: (_payload: { staffId: number; openingCash: number }) => {
        activeShift = { id: 1, staff_id: _payload.staffId, opened_at: new Date().toISOString(), opening_cash: _payload.openingCash, closed_at: null, closing_cash: null, note: null };
        return Promise.resolve({ success: true, data: { id: 1 } });
      },
      close: (_payload: { shiftId: number; closingCash: number; note?: string }) => {
        activeShift = null;
        return Promise.resolve({ success: true });
      },
      getTotals: (_payload: { openedAt: string }) => Promise.resolve({ success: true, data: { cash: 0, card: 0, jazzcash: 0, easypaisa: 0, bank_transfer: 0, other: 0 } }),
      list: () => Promise.resolve({ success: true, data: [] }),
      addCashEntry: () => Promise.resolve({ success: true }),
      getCashEntries: () => Promise.resolve({ success: true, data: [] }),
    };
  })(),
  reports: {
    daily: () => Promise.resolve({
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        totalOrders: 0,
        totalRevenue: 0,
        totalTax: 0,
        totalServiceCharge: 0,
        hourlyData: []
      }
    }),
    sales: () => Promise.resolve({ success: true, data: {} }),
    products: () => Promise.resolve({ success: true, data: [] }),
    categories: () => Promise.resolve({ success: true, data: [] }),
    modifiers: () => Promise.resolve({ success: true, data: [] }),
    tables: () => Promise.resolve({ success: true, data: [] }),
    kitchen: () => Promise.resolve({ success: true, data: [] }),
    inventory: () => Promise.resolve({ success: true, data: [] }),
    expenses: () => Promise.resolve({ success: true, data: [] }),
    gst: () => Promise.resolve({ success: true, data: {} }),
    tax: () => Promise.resolve({ success: true, data: [] }),
    getPastOrders: () => Promise.resolve({ success: true, data: { stats: { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0 }, orders: [], totalPages: 1, currentPage: 1 } }),
    printPastBill: () => Promise.resolve({ success: true }),
  },
  backup: {
    export: () => Promise.resolve({ success: true, data: '/mock/backup.db' }),
    import: () => Promise.resolve({ success: true }),
    getAutoBackupConfig: () => Promise.resolve({ success: true, data: { autoBackup: { enabled: false, frequency: 'daily' as const, path: null, dayOfWeek: 1, lastBackupAt: null }, backupReminder: { enabled: false, frequency: 'daily' as const, time: '20:00', dayOfWeek: 1, dayOfMonth: 1, lastRemindedDate: null } } }),
    setAutoBackupConfig: () => Promise.resolve({ success: true }),
    selectAutoBackupPath: () => Promise.resolve({ success: true, data: '/mock/backups' }),
    triggerNow: () => Promise.resolve({ success: true }),
  },
  settings: (() => {
    let settingsStore: Record<string, unknown> = { outlet_name: 'Mock Restaurant' };
    return {
      get: () => Promise.resolve({ success: true, data: settingsStore }),
      save: (payload: Record<string, unknown>) => {
        settingsStore = { ...settingsStore, ...payload };
        return Promise.resolve({ success: true });
      },
    };
  })(),
  system: {
    isSetupComplete: () => Promise.resolve({ success: true, data: true }),
    completeSetup: (_payload: { restaurantName: string; adminName: string; adminPin: string }) => Promise.resolve({ success: true }),
    factoryReset: () => Promise.resolve({ success: true }),
    generateRecoveryCode: () => Promise.resolve({ success: true }),
    verifyRecoveryCode: () => Promise.resolve({ success: true }),
    resetAdminPin: () => Promise.resolve({ success: true }),
  },
  expenses: {
    getAll: () => Promise.resolve({ success: true, data: [] }),
    getCategories: () => Promise.resolve({ success: true, data: [] }),
    create: () => Promise.resolve({ success: true, data: { id: 1 } }),
    delete: () => Promise.resolve({ success: true }),
  },
  customers: {
    getAll: () => Promise.resolve({ success: true, data: [] }),
    getById: () => Promise.resolve({ success: true, data: null }),
    create: () => Promise.resolve({ success: true, data: { id: 1 } }),
    update: () => Promise.resolve({ success: true }),
    delete: () => Promise.resolve({ success: true }),
    search: () => Promise.resolve({ success: true, data: [] }),
    settleBalance: () => Promise.resolve({ success: true }),
    getHistory: () => Promise.resolve({ success: true, data: [] }),
  },
  dashboard: {
    getMetrics: () => Promise.resolve({
      success: true,
      data: {
        metrics: {
          totalSales: 0, totalOrders: 0, averageOrderValue: 0, totalCovers: 0, outstandingBalances: 0,
          cash: 0, card: 0, jazzcash: 0, easypaisa: 0, bank_transfer: 0, other: 0, unpaid: 0,
          openTables: 0, kitchenPendingKots: 0, completedOrdersToday: 0, lowStockCount: 0,
        },
        trendData: [], topItemsData: [], lowStock: [], recentOrders: [],
      }
    }),
  },
  businessSession: (() => {
    let session: BusinessSession | null = null;
    return {
      getActive: () => Promise.resolve({ success: true, data: session }),
      start: (payload: { staffId: number; notes?: string }) => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        session = { id: 1, business_date: `${y}-${m}-${d}`, started_at: now.toISOString(), closed_at: null, status: 'open', started_by: payload.staffId, closed_by: null, notes: payload.notes ?? null };
        return Promise.resolve({ success: true, data: session });
      },
      close: (_payload: { sessionId: number; staffId: number; notes?: string }) => {
        session = null;
        return Promise.resolve({ success: true });
      },
    };
  })(),
  auth: {
    check: () => Promise.resolve({ success: true, data: true }),
  },
  onBackupReminder: (_callback: () => void) => () => {
    // mock: no-op unsubscribe
  },
  onMenuScheduleTriggered: (_callback: (data: { menuId: number; menuName: string; action: 'enabled' | 'disabled' }) => void) => () => {
    // mock: no-op unsubscribe
  },
  onSettingsUpdated: (_callback: () => void) => () => {
    // mock: no-op unsubscribe
  },
};

// Mock IPC is only allowed in tests (Vitest) or when the developer opts in
// explicitly with VITE_USE_MOCK_IPC=true. In production this must never fall
// back silently because it would hide a missing Electron preload bridge and
// could mask backend authorization failures.
const allowMockIpc = import.meta.env.MODE === 'test' || import.meta.env.VITE_USE_MOCK_IPC === 'true';
let resolvedApi: unknown = ipcApi;
if (!resolvedApi && allowMockIpc) {
  resolvedApi = mockApi;
}
if (!resolvedApi) {
  throw new Error('Electron preload API is unavailable. In production the app must run inside Electron; mock IPC is disabled unless VITE_USE_MOCK_IPC=true (development/test only).');
}

export const api = resolvedApi as {
  orders: {
    create: (payload: { tableId?: number | null; staffId?: number; covers?: number; note?: string; customerId?: number; type?: 'dine-in' | 'takeaway' | 'delivery'; status?: 'DRAFT' | 'OPEN' }) => Promise<IPCResponse<{ id: number; order_number: string }>>;
    addItems: (payload: { orderId: number; items: OrderLineInput[]; staffId?: number; keepDraft?: boolean }) => Promise<IPCResponse<{ added: number; order: unknown }>>;
    updateItemQty: (payload: { orderId: number; orderItemId: number; qty: number }) => Promise<IPCResponse<unknown>>;
    updateItemNote: (payload: { orderId: number; orderItemId: number; note: string | null }) => Promise<IPCResponse<unknown>>;
    voidItem: (payload: { orderId: number; orderItemId: number; reason?: string }) => Promise<IPCResponse<unknown>>;
    getOpen: () => Promise<IPCResponse<unknown[]>>;
    getDraft: () => Promise<IPCResponse<(Order & { items: OrderItem[] }) | null>>;
    discardDraft: (payload?: { orderId?: number }) => Promise<IPCResponse<unknown>>;
    getById: (payload: { orderId: number }) => Promise<IPCResponse<(Order & { items: OrderItem[] }) | null>>;
    getByTable: (payload: { tableId: number }) => Promise<IPCResponse<(Order & { items: OrderItem[]; customer_name?: string | null }) | null>>;
    sendKOT: (payload: { orderId: number; staffId?: number }) => Promise<IPCResponse<SendKOTResult>>;
    updateStatus: (payload: { orderId: number; status: string; reason?: string }) => Promise<IPCResponse<unknown>>;
    updateType: (payload: { orderId: number; type: 'dine-in' | 'takeaway' | 'delivery'; deliveryAddress?: string | null }) => Promise<IPCResponse<unknown>>;
    applyDiscount: (payload: { orderId: number; discount: { type: 'PERCENT' | 'FIXED' | null; percent: number; minor: number } }) => Promise<IPCResponse<unknown>>;
    changeTable: (payload: { orderId: number; tableId: number }) => Promise<IPCResponse<unknown>>;
    cancelOrder: (payload: { orderId: number; note?: string }) => Promise<IPCResponse<unknown>>;
    updateCustomer: (payload: { orderId: number; customerId: number }) => Promise<IPCResponse<unknown>>;
  };
  kds: {
    getActiveTickets: (payload?: { since?: string }) => Promise<IPCResponse<KDSTicket[]>>;
    updateItemStatus: (payload: { itemId: number; status: KDSItemStatus }) => Promise<IPCResponse<unknown>>;
    updateKotStatus: (payload: { kotId: number; status: KDSOrderStatus }) => Promise<IPCResponse<unknown>>;
    updateOrderStatus: (payload: { orderId: number; status: KDSOrderStatus }) => Promise<IPCResponse<unknown>>;
  };
  menu: {
    getMenus: () => Promise<IPCResponse<import('../types/models').Menu[]>>;
    upsertMenu: (payload: { id?: number; name: string; is_default?: number; is_active?: number; auto_enable_time?: string | null; auto_disable_time?: string | null; schedule_enabled?: number; }) => Promise<IPCResponse<{ id: number }>>;
    duplicateMenu: (payload: { id: number; newName: string }) => Promise<IPCResponse<{ id: number }>>;
    uploadImage: () => Promise<IPCResponse<string>>;
    getAll: (menuId?: number) => Promise<IPCResponse<(Category & { items: MenuItem[] })[]>>;
    upsertItem: (payload: Partial<MenuItem>) => Promise<IPCResponse<{ id: number }>>;
    deleteItem: (payload: { id: number }) => Promise<IPCResponse<unknown>>;
    toggleAvailable: (payload: { id: number; is_available: number }) => Promise<IPCResponse<unknown>>;
    upsertCategory: (payload: Partial<Category>) => Promise<IPCResponse<Category>>;
    deleteCategory: (payload: { id: number }) => Promise<IPCResponse<unknown>>;
    getRecipe: (payload: { menu_item_id: number }) => Promise<IPCResponse<RecipeItem[]>>;
    updateRecipe: (payload: { menu_item_id: number; ingredients: { inventory_item_id: number; qty_used: number }[] }) => Promise<IPCResponse<unknown>>;
  };
  tables: {
    getAll: () => Promise<IPCResponse<Table[]>>;
    upsert: (payload: Partial<Table>) => Promise<IPCResponse<Table>>;
    delete: (payload: { id: number }) => Promise<IPCResponse<unknown>>;
    updateCustomName: (payload: { id: number; customName: string | null }) => Promise<IPCResponse<unknown>>;
  };
  stage2: {
    categories: {
      list: (payload: { menuId: number; includeInactive?: boolean }) => Promise<IPCResponse<Stage2Category[]>>;
      save: (payload: { id?: number; menu_id: number; name: string; sort_order?: number; is_active?: number | boolean }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
    };
    menuItems: {
      list: (payload?: { categoryId?: number; search?: string; includeInactive?: boolean }) => Promise<IPCResponse<Stage2MenuItem[]>>;
      save: (payload: { id?: number; category_id: number; name: string; price?: number | string; price_minor?: number; is_veg?: number | boolean; is_available?: number | boolean; is_active?: number | boolean; sort_order?: number; tax_name?: string | null; tax_rate?: number | null; tax_mode?: 'exclusive' | 'inclusive' | null; dietary_label?: string | null }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
      setAvailability: (payload: { id: number; isAvailable: number | boolean }) => Promise<IPCResponse<unknown>>;
    };
    variants: {
      list: (payload: { menuItemId: number; includeInactive?: boolean }) => Promise<IPCResponse<MenuItemVariant[]>>;
      save: (payload: { id?: number; menu_item_id: number; name: string; price?: number | string; price_minor?: number; is_active?: number | boolean; sort_order?: number }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
    };
    modifierGroups: {
      list: (payload?: { includeInactive?: boolean }) => Promise<IPCResponse<ModifierGroup[]>>;
      save: (payload: { id?: number; name: string; selection_type?: 'single' | 'multiple'; min_selections?: number; max_selections?: number | null; is_active?: number | boolean; sort_order?: number }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
    };
    modifiers: {
      list: (payload: { modifierGroupId: number; includeInactive?: boolean }) => Promise<IPCResponse<Modifier[]>>;
      save: (payload: { id?: number; modifier_group_id: number; name: string; price?: number | string; price_minor?: number; is_active?: number | boolean; sort_order?: number }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
    };
    menuItemModifierGroups: {
      list: (menuItemId: number) => Promise<IPCResponse<ModifierGroup[]>>;
      set: (payload: { menuItemId: number; modifierGroupIds: number[] }) => Promise<IPCResponse<unknown>>;
    };
    diningAreas: {
      list: (payload?: { includeInactive?: boolean }) => Promise<IPCResponse<DiningArea[]>>;
      save: (payload: { id?: number; name: string; sort_order?: number; is_active?: number | boolean }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
    };
    tables: {
      list: (payload?: { diningAreaId?: number; includeInactive?: boolean }) => Promise<IPCResponse<Stage2Table[]>>;
      save: (payload: { id?: number; dining_area_id: number; identifier: string; name?: string; capacity: number; status?: Stage2TableStatus; shape?: Stage2TableShape; is_active?: number | boolean; position_x?: number; position_y?: number; width?: number; height?: number; rotation?: number }) => Promise<IPCResponse<{ id: number }>>;
      deactivate: (id: number) => Promise<IPCResponse<unknown>>;
      updateStatus: (payload: { id: number; status: Stage2TableStatus }) => Promise<IPCResponse<unknown>>;
      updateLayout: (payload: { id: number; position_x?: number; position_y?: number; width?: number; height?: number; rotation?: number; shape?: Stage2TableShape }) => Promise<IPCResponse<unknown>>;
    };
    audit: {
      list: (limit?: number) => Promise<IPCResponse<unknown[]>>;
    };
  };
  payments: {
    updateStatus: (payload: { paymentId: number; status: string; providerReference?: string; failureReason?: string; metadata?: Record<string, unknown> }) => Promise<IPCResponse<unknown>>;
    verify: (payload: { paymentId: number }) => Promise<IPCResponse<unknown>>;
  };
  billing: {
    createBill: (payload: unknown) => Promise<IPCResponse<unknown>>;
    getBill: (payload: unknown) => Promise<IPCResponse<unknown>>;
  };
  print: {
    kot: (payload: unknown) => Promise<IPCResponse<unknown>>;
    bill: (payload: unknown) => Promise<IPCResponse<unknown>>;
  };
  inventory: {
    getAll: () => Promise<IPCResponse<InventoryItem[]>>;
    getLowStock: () => Promise<IPCResponse<unknown[]>>;
    getMovements: (payload?: { itemId?: number; limit?: number }) => Promise<IPCResponse<unknown[]>>;
    convert: (payload: { value: number; from: string; to: string }) => Promise<IPCResponse<number>>;
    adjust: (payload: { item_id: number; type: 'purchase' | 'sale' | 'adjustment' | 'wastage' | 'return' | 'correction'; qty_change: number; note?: string; }) => Promise<IPCResponse<unknown>>;
    upsertItem: (payload: Partial<InventoryItem>) => Promise<IPCResponse<{ id: number }>>;
    updateRecipe: (payload: { menuItemId: number; ingredients: { inventory_item_id: number; qty_used: number }[] }) => Promise<IPCResponse<unknown>>;
  };
  suppliers: {
    list: (payload?: { includeInactive?: boolean }) => Promise<IPCResponse<Supplier[]>>;
    save: (payload: { id?: number; name: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; is_active?: number | boolean }) => Promise<IPCResponse<{ id: number }>>;
  };
  purchases: {
    list: (payload?: { supplierId?: number; limit?: number }) => Promise<IPCResponse<Purchase[]>>;
    items: (payload: { purchaseId: number }) => Promise<IPCResponse<PurchaseItem[]>>;
    create: (payload: { supplier_id: number; items: { inventory_item_id: number; qty: number; unit_cost: number | string }[]; note?: string | null }) => Promise<IPCResponse<{ id: number; purchase_number: string }>>;
    receive: (payload: { purchaseId: number }) => Promise<IPCResponse<unknown>>;
    cancel: (payload: { purchaseId: number }) => Promise<IPCResponse<unknown>>;
  };
  audit: {
    list: (payload?: { entityType?: string; action?: string; limit?: number }) => Promise<IPCResponse<unknown[]>>;
  };
  staff: {
    login: (payload: { pin: string }) => Promise<IPCResponse<{ id: number; name: string; role: string }>>;
    logout: () => Promise<IPCResponse<unknown>>;
    getAll: () => Promise<IPCResponse<Staff[]>>;
    upsert: (payload: Partial<Staff> & { pin: string }) => Promise<IPCResponse<{ id: number }>>;
    delete: (payload: { id: number }) => Promise<IPCResponse<unknown>>;
    changePin: (payload: { id: number, currentPin: string, newPin: string }) => Promise<IPCResponse<unknown>>;
  };
  shifts: {
    getActive: () => Promise<IPCResponse<Shift | null>>;
    open: (payload: { staffId: number; openingCash: number }) => Promise<IPCResponse<{ id: number }>>;
    close: (payload: { shiftId: number; closingCash: number; note?: string }) => Promise<IPCResponse<unknown>>;
    getTotals: (payload: { openedAt: string }) => Promise<IPCResponse<{ cash: number; card: number; jazzcash: number; easypaisa: number; bank_transfer: number; other: number; unpaid?: number }>>;
    list: (payload?: { limit?: number }) => Promise<IPCResponse<unknown[]>>;
    addCashEntry: (payload: { shiftId: number; type: 'CASH_IN' | 'CASH_OUT'; amount: number | string; note?: string }) => Promise<IPCResponse<unknown>>;
    getCashEntries: (payload: { shiftId: number }) => Promise<IPCResponse<unknown[]>>;
  };
  reports: {
    daily: (payload: { filter: string; start?: string; end?: string }) => Promise<IPCResponse<{ date: string; totalOrders: number; totalRevenue: number; totalTax: number; totalServiceCharge: number; hourlyData: { hour: string; orders: number; revenue: number }[] }>>;
    sales: (payload: unknown) => Promise<IPCResponse<unknown>>;
    products: (payload: unknown) => Promise<IPCResponse<unknown>>;
    categories: (payload: unknown) => Promise<IPCResponse<unknown>>;
    modifiers: (payload: unknown) => Promise<IPCResponse<unknown>>;
    tables: (payload: unknown) => Promise<IPCResponse<unknown>>;
    kitchen: (payload: unknown) => Promise<IPCResponse<unknown>>;
    inventory: (payload?: unknown) => Promise<IPCResponse<unknown>>;
    expenses: (payload: unknown) => Promise<IPCResponse<unknown>>;
    gst: (payload: unknown) => Promise<IPCResponse<unknown>>;
    tax: () => Promise<IPCResponse<unknown>>;
    getPastOrders: (payload: { filter: 'daily' | 'weekly' | 'monthly' | 'yearly'; page: number; limit: number }) => Promise<IPCResponse<{ stats: import('../types/models').PastOrderStats; orders: import('../types/models').PastOrderData[]; totalPages: number; currentPage: number }>>;
    printPastBill: (payload: { orderId: number }) => Promise<IPCResponse<unknown>>;
  };
  backup: {
    export: (payload: unknown) => Promise<IPCResponse<string>>;
    import: (payload: unknown) => Promise<IPCResponse<unknown>>;
    getAutoBackupConfig: () => Promise<IPCResponse<{ autoBackup: AutoBackupConfig; backupReminder: BackupReminderConfig }>>;
    setAutoBackupConfig: (payload: { autoBackup?: Partial<AutoBackupConfig>; backupReminder?: Partial<BackupReminderConfig> }) => Promise<IPCResponse<unknown>>;
    selectAutoBackupPath: () => Promise<IPCResponse<string>>;
    triggerNow: () => Promise<IPCResponse<unknown>>;
  };
  settings: {
    get: () => Promise<IPCResponse<unknown>>;
    save: (payload: unknown) => Promise<IPCResponse<unknown>>;
  };
  system: {
    isSetupComplete: () => Promise<IPCResponse<boolean>>;
    completeSetup: (payload: { restaurantName: string; adminName: string; adminPin: string }) => Promise<IPCResponse<unknown>>;
    factoryReset: () => Promise<IPCResponse<unknown>>;
    generateRecoveryCode: () => Promise<IPCResponse<unknown>>;
    verifyRecoveryCode: (payload: { code: string }) => Promise<IPCResponse<unknown>>;
    resetAdminPin: (payload: { newPin: string; code: string }) => Promise<IPCResponse<unknown>>;
  };
  expenses: {
    getAll: (payload?: { start?: string, end?: string }) => Promise<IPCResponse<Expense[]>>;
    getCategories: () => Promise<IPCResponse<unknown[]>>;
    create: (payload: { date: string, category: string, amount: number, description?: string, staff_id?: number, payment_method?: string }) => Promise<IPCResponse<{ id: number }>>;
    delete: (payload: { id: number }) => Promise<IPCResponse<unknown>>;
  };
  customers: {
    getAll: () => Promise<IPCResponse<import('../types/models').Customer[]>>;
    getById: (id: number) => Promise<IPCResponse<import('../types/models').Customer>>;
    create: (payload: Partial<import('../types/models').Customer>) => Promise<IPCResponse<{ id: number }>>;
    update: (payload: Partial<import('../types/models').Customer> & { id: number }) => Promise<IPCResponse<unknown>>;
    delete: (payload: number) => Promise<IPCResponse<unknown>>;
    search: (payload: string) => Promise<IPCResponse<import('../types/models').Customer[]>>;
    settleBalance: (payload: { customerId: number; amount: number; method: string }) => Promise<IPCResponse<unknown>>;
    getHistory: (payload: number) => Promise<IPCResponse<import('../types/models').CustomerHistory[]>>;
  };
  dashboard: {
    getMetrics: (payload: { filter: string }) => Promise<IPCResponse<{
      metrics: {
        totalSales: number;
        totalOrders: number;
        averageOrderValue: number;
        totalCovers: number;
        outstandingBalances: number;
        cash: number;
        card: number;
        jazzcash: number;
        easypaisa: number;
        bank_transfer: number;
        other: number;
        unpaid: number;
        openTables: number;
        kitchenPendingKots: number;
        completedOrdersToday: number;
        lowStockCount: number;
      };
      trendData: { label: string; sales: number; orders: number }[];
      topItemsData: { name: string; quantity: number; revenue: number }[];
      lowStock: unknown[];
      recentOrders: unknown[];
    }>>;
  };
  businessSession: {
    getActive: () => Promise<IPCResponse<BusinessSession | null>>;
    start: (payload: { staffId: number; notes?: string }) => Promise<IPCResponse<BusinessSession>>;
    close: (payload: { sessionId: number; staffId: number; notes?: string }) => Promise<IPCResponse<unknown>>;
  };
  auth: {
    check: (payload: { permission: string }) => Promise<IPCResponse<boolean>>;
  };
  /** Subscribes to the backup reminder. Returns an unsubscribe function. */
  onBackupReminder: (callback: () => void) => () => void;
  /** Subscribes to menu schedule changes. Returns an unsubscribe function. */
  onMenuScheduleTriggered: (callback: (data: { menuId: number; menuName: string; action: 'enabled' | 'disabled' }) => void) => () => void;
  /** Subscribes to settings changes broadcast by the main process. Returns an unsubscribe function. */
  onSettingsUpdated: (callback: () => void) => () => void;
};
