import { ipcMain } from 'electron';
import Store from 'electron-store';
import { assertCurrentPermission } from '../services/authz';

const store = new Store();

export const DEFAULT_PAKISTAN_SETTINGS: Record<string, unknown> = {
  country: 'Pakistan',
  currency: 'PKR',
  currency_symbol: 'Rs',
  currency_locale: 'en-PK',
  timezone: 'Asia/Karachi',
  date_format: 'dd/MM/yyyy',
  time_format: '12h',
  restaurant_name: 'Restaurant POS',
  outlet_name: 'Restaurant POS',
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
};

function withDefaults(data: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_PAKISTAN_SETTINGS, ...data, is_gst_enabled: false };
}

export function registerSettingsIPC() {
  ipcMain.handle('settings:get', async () => ({ success: true, data: withDefaults(store.store) }));
  
  ipcMain.handle('settings:save', async (_, payload: Record<string, unknown>) => {
    try {
      assertCurrentPermission('settings');
      if ('tax_enabled' in payload || 'tax_name' in payload || 'tax_rate' in payload || 'tax_mode' in payload || 'tax_rounding' in payload) {
        assertCurrentPermission('tax_configuration');
      }
      const sanitized = { ...payload };
      // Keep legacy GST disabled by default in Pakistanized installs. Historical DB fields remain intact.
      if ('is_gst_enabled' in sanitized) {sanitized.is_gst_enabled = false;}
      for (const [key, value] of Object.entries(sanitized)) {
        store.set(key, value);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}

export function getSetting<T>(key: string, defaultValue: T): T {
  return store.get(key, defaultValue) as T;
}
