import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission } from '../services/authz';
import { readAuditLogs, AuditQuery } from '../services/audit';

export function registerAuditIPC() {
  ipcMain.handle('audit:list', async (_event, payload: AuditQuery = {}) => {
    try {
      assertCurrentPermission('audit_view');
      return { success: true, data: readAuditLogs(getDB(), payload) };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
