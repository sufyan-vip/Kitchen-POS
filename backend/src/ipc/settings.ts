import { ipcMain, BrowserWindow } from 'electron';
import { assertCurrentPermission } from '../services/authz';
import { DEFAULT_PAKISTAN_SETTINGS, getSettingsStore } from '../services/settings';

function withDefaults(data: Record<string, unknown>): Record<string, unknown> {
  return { ...DEFAULT_PAKISTAN_SETTINGS, ...data, is_gst_enabled: false };
}

export function registerSettingsIPC() {
  ipcMain.handle('settings:get', async () => {
    const store = getSettingsStore();
    return { success: true, data: withDefaults({ ...(store as { store?: Record<string, unknown> }).store ?? {} }) };
  });

  ipcMain.handle('settings:save', async (_event, payload: Record<string, unknown>) => {
    try {
      assertCurrentPermission('settings');
      if ('tax_enabled' in payload || 'tax_name' in payload || 'tax_rate' in payload || 'tax_mode' in payload || 'tax_rounding' in payload || 'service_charge_enabled' in payload || 'service_charge_rate' in payload) {
        assertCurrentPermission('tax_configuration');
      }
      const sanitized = { ...payload };
      // Keep legacy GST disabled by default in Pakistanized installs. Historical DB fields remain intact.
      if ('is_gst_enabled' in sanitized) { sanitized.is_gst_enabled = false; }
      const store = getSettingsStore();
      for (const [key, value] of Object.entries(sanitized)) {
        store.set(key, value);
      }
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('settings-updated');
      }
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
