import { ipcMain, app, dialog } from 'electron';
import { getDB, closeDB } from '../db';
import * as path from 'path';
import * as fs from 'fs';
import { generateSalt, hashPin, generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from '../services/passwords';
import { asText } from './text';
import { getSettingsStore } from '../services/settings';

const MAX_RECOVERY_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
let recoveryFailedAttempts = 0;
let lockoutUntilMs = 0;

export function resetRecoveryRateLimit(): void {
  recoveryFailedAttempts = 0;
  lockoutUntilMs = 0;
}

function checkRecoveryRateLimit(): void {
  const now = Date.now();
  if (now < lockoutUntilMs) {
    const minutesLeft = Math.ceil((lockoutUntilMs - now) / 60000);
    throw new Error(`Too many failed attempts. Please try again after ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`);
  }
}

function recordFailedRecoveryAttempt(): void {
  recoveryFailedAttempts += 1;
  if (recoveryFailedAttempts >= MAX_RECOVERY_ATTEMPTS) {
    lockoutUntilMs = Date.now() + LOCKOUT_WINDOW_MS;
    recoveryFailedAttempts = 0;
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error occurred';
}

function setAdminPin(db: ReturnType<typeof getDB>, pin: string): void {
  const salt = generateSalt();
  db.prepare('UPDATE staff SET name = name, pin_hash = ?, pin_salt = ?, pin = NULL WHERE role = "admin"')
    .run(hashPin(pin, salt), salt);
}

export function registerSystemIPC() {
  ipcMain.handle('system:isSetupComplete', async () => {
    try {
      const isComplete = getSettingsStore().get('is_setup_complete', false);
      return { success: true, data: isComplete };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('system:completeSetup', async (_, payload: { restaurantName: string; adminName: unknown; adminPin: unknown }) => {
    try {
      const db = getDB();
      const adminPin = asText(payload.adminPin);
      if (adminPin.length < 4 || adminPin.length > 10) { throw new Error('Admin PIN must be 4-10 characters'); }
      const salt = generateSalt();
      db.prepare('UPDATE staff SET name = ?, pin_hash = ?, pin_salt = ?, pin = NULL WHERE role = "admin"')
        .run(asText(payload.adminName).trim() || 'Admin', hashPin(adminPin, salt), salt);

      const store = getSettingsStore();
      store.set('outlet_name', payload.restaurantName);
      store.set('is_setup_complete', true);

      return { success: true };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('system:factoryReset', async () => {
    try {
      // 1. Close DB connection
      closeDB();

      // 2. Clear store (if supported)
      const store = getSettingsStore() as unknown as { clear?: () => void };
      if (typeof store.clear === 'function') {
        store.clear();
      }

      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'pos.db');
      const dbShmPath = path.join(userDataPath, 'pos.db-shm');
      const dbWalPath = path.join(userDataPath, 'pos.db-wal');
      const imagesPath = path.join(userDataPath, 'images');

      if (fs.existsSync(dbPath)) { fs.unlinkSync(dbPath); }
      if (fs.existsSync(dbShmPath)) { fs.unlinkSync(dbShmPath); }
      if (fs.existsSync(dbWalPath)) { fs.unlinkSync(dbWalPath); }

      // 4. Delete images directory
      if (fs.existsSync(imagesPath)) {
        fs.rmSync(imagesPath, { recursive: true, force: true });
      }

      // 5. Relaunch
      app.relaunch();
      app.exit(0);

      return { success: true };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('system:generateRecoveryCode', async () => {
    try {
      const code = generateRecoveryCode();

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Recovery Code',
        defaultPath: 'kitchen-pos-recovery-code.txt',
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      });

      if (canceled || !filePath) {
        return { success: false, error: 'Cancelled' };
      }

      const content = `KITCHEN-POS RECOVERY CODE\n-------------------------\nKeep this code safe. If you forget your PIN, you can use this code to reset the Admin PIN.\n\nRecovery Code: ${code}\n`;
      fs.writeFileSync(filePath, content, 'utf-8');

      const store = getSettingsStore() as unknown as { set: (k: string, v: unknown) => void; delete?: (k: string) => void };
      // Store only a digest — never the plaintext code.
      store.set('recovery_code_hash', hashRecoveryCode(code));
      if (typeof store.delete === 'function') {
        store.delete('recovery_code');
      }

      resetRecoveryRateLimit();

      return { success: true };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('system:verifyRecoveryCode', async (_, payload: { code: string }) => {
    try {
      checkRecoveryRateLimit();
      const store = getSettingsStore();
      const storedHash = store.get('recovery_code_hash') as string | undefined;
      const legacyCode = store.get('recovery_code') as string | undefined;
      if ((storedHash && verifyRecoveryCode(payload.code, storedHash)) || (legacyCode && legacyCode === payload.code.trim().toUpperCase())) {
        resetRecoveryRateLimit();
        return { success: true };
      }
      recordFailedRecoveryAttempt();
      return { success: false, error: 'Invalid recovery code' };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });

  ipcMain.handle('system:resetAdminPin', async (_, payload: { newPin: unknown; code: string }) => {
    try {
      checkRecoveryRateLimit();
      const store = getSettingsStore();
      const storedHash = store.get('recovery_code_hash') as string | undefined;
      const legacyCode = store.get('recovery_code') as string | undefined;
      let codeValid = false;
      if (storedHash && verifyRecoveryCode(payload.code, storedHash)) { codeValid = true; }
      if (!codeValid && legacyCode && legacyCode === payload.code.trim().toUpperCase()) { codeValid = true; }
      if (!codeValid) {
        recordFailedRecoveryAttempt();
        return { success: false, error: 'Invalid recovery code' };
      }

      const newPin = asText(payload.newPin);
      if (newPin.length < 4 || newPin.length > 10) { return { success: false, error: 'PIN must be 4-10 characters' }; }
      const db = getDB();
      setAdminPin(db, newPin);
      resetRecoveryRateLimit();
      
      return { success: true };
    } catch (e) {
      return { success: false, error: errMsg(e) };
    }
  });
}
