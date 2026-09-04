export interface AppSettings {
  country: string;
  currency: string;
  currency_symbol: string;
  currency_locale: string;
  timezone: string;
  date_format: string;
  time_format: string;
  restaurant_name: string;
  outlet_name: string;
  address: string;
  city: string;
  province: string;
  phone: string;
  email: string;
  website: string;
  receipt_footer: string;
  invoice_prefix: string;
  tax_enabled: boolean;
  tax_name: string;
  tax_rate: number;
  tax_mode: 'exclusive' | 'inclusive';
  tax_rounding: 'line' | 'bill';
  service_charge_enabled: boolean;
  service_charge_rate: number;
  delivery_charge: number;
  payment_methods: string[];
  is_gst_enabled: boolean;
  // Order behaviour
  inventory_auto_debit: boolean;
  allow_negative_inventory: boolean;
  auto_release_table_on_bill: boolean;
}

export const DEFAULT_PAKISTAN_SETTINGS: AppSettings = {
  country: 'Pakistan',
  currency: 'PKR',
  currency_symbol: 'Rs',
  currency_locale: 'en-PK',
  timezone: 'Asia/Karachi',
  date_format: 'dd/MM/yyyy',
  time_format: '12h',
  restaurant_name: 'S Restaurant',
  outlet_name: 'S Restaurant',
  address: '',
  city: '',
  province: '',
  phone: '',
  email: '',
  website: '',
  receipt_footer: 'Thank You!',
  invoice_prefix: 'INV',
  tax_enabled: false,
  tax_name: 'Sales Tax',
  tax_rate: 0,
  tax_mode: 'exclusive',
  tax_rounding: 'line',
  service_charge_enabled: false,
  service_charge_rate: 0,
  delivery_charge: 0,
  payment_methods: ['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'other'],
  is_gst_enabled: false,
  inventory_auto_debit: true,
  allow_negative_inventory: false,
  auto_release_table_on_bill: true,
};

export interface SettingsStore {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
}

let storeOverride: SettingsStore | null = null;

/** Test hook: swap the backing store (e.g. an in-memory mock). */
export function setSettingsStore(store: SettingsStore | null): void {
  storeOverride = store;
}

// Lazy so the module graph loads in plain-node tests.
export function getSettingsStore(): SettingsStore {
  if (storeOverride) { return storeOverride; }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Store = require('electron-store').default as new () => SettingsStore;
  return new Store();
}

export function getSetting<T>(key: string, defaultValue: T): T {
  return getSettingsStore().get(key, defaultValue) as T;
}

export function setSetting(key: string, value: unknown): void {
  getSettingsStore().set(key, value);
}

export function getAppSettings(): AppSettings {
  const store = getSettingsStore();
  const data = Object.fromEntries(Object.keys(DEFAULT_PAKISTAN_SETTINGS).map(key => [key, store.get(key, (DEFAULT_PAKISTAN_SETTINGS as unknown as Record<string, unknown>)[key])]));
  return { ...DEFAULT_PAKISTAN_SETTINGS, ...data, is_gst_enabled: false };
}
