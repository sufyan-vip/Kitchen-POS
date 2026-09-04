import { ipcMain, dialog, app } from 'electron';
import { getDB, closeDB } from '../db';
import * as fs from 'fs';
import * as path from 'path';
import { pruneOldBackups, formatLocalDate, checkShouldFireReminder, type BackupReminderConfig } from './backup-utils';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import { assertCurrentPermission } from '../services/authz';
import { getSettingsStore } from '../services/settings';

interface AutoBackupConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  path: string | null;
  dayOfWeek: number;
  lastBackupAt: string | null;
}

const DEFAULT_AUTO_BACKUP: AutoBackupConfig = {
  enabled: false,
  frequency: 'daily',
  path: null,
  dayOfWeek: 1,
  lastBackupAt: null,
};

const DEFAULT_REMINDER: BackupReminderConfig = {
  enabled: false,
  frequency: 'daily',
  time: '20:00',
  dayOfWeek: 1,
  dayOfMonth: 1,
  lastRemindedDate: null,
};

/**
 * True when a scheduled backup has not run yet for the current period.
 * Comparing against `lastBackupAt` (instead of firing only at exactly 00:00)
 * means a machine that was switched off overnight still backs up on the next
 * launch, and a machine left running never backs up twice for the same day.
 */
export function isAutoBackupDue(config: AutoBackupConfig, now: Date): boolean {
  if (!config.enabled) { return false; }
  if (!config.lastBackupAt) { return true; }
  const last = new Date(config.lastBackupAt);
  if (Number.isNaN(last.getTime())) { return true; }
  if (config.frequency === 'weekly') {
    return now.getTime() - last.getTime() >= 7 * 24 * 60 * 60 * 1000;
  }
  return formatLocalDate(last) !== formatLocalDate(now);
}

export async function performAutoBackup(options: { force?: boolean } = {}): Promise<string> {
  const store = getSettingsStore();
  const config = store.get('autoBackup', DEFAULT_AUTO_BACKUP) as AutoBackupConfig;
  const now = new Date();

  if (!options.force) {
    if (!config.enabled) { return ''; }
    if (!isAutoBackupDue(config, now)) { return ''; }
  }

  const db = getDB();
  const backupDir = config.path ?? app.getPath('userData');
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(backupDir, `kitchen-pos-backup-${ts}.zip`);
  const tempDbPath = path.join(app.getPath('temp'), `pos-temp-${Date.now()}.db`);

  try {
    await db.backup(tempDbPath);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(backupPath);
      const createArchive = archiver as unknown as (format: string, options: unknown) => {
        on: (event: string, cb: (err: Error) => void) => void;
        pipe: (dest: fs.WriteStream) => void;
        file: (file: string, options: { name: string }) => void;
        directory: (dir: string, name: string) => void;
        finalize: () => Promise<void>;
      };
      const archive = createArchive('zip', { zlib: { level: 9 } });
      output.on('close', () => { resolve(); });
      // Without this listener a disk-full/permission failure emits an
      // unhandled 'error' event and takes down the main process.
      output.on('error', (err: Error) => { reject(err); });
      archive.on('error', (err: Error) => { reject(err); });

      archive.pipe(output);
      archive.file(tempDbPath, { name: 'pos.db' });

      const imagesDir = path.join(app.getPath('userData'), 'images');
      if (fs.existsSync(imagesDir)) {
        archive.directory(imagesDir, 'images');
      }

      void archive.finalize();
    });

    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }

    store.set('autoBackup', { ...config, lastBackupAt: now.toISOString() });
    pruneOldBackups(backupDir, 7);
    return backupPath;
  } catch (e: unknown) {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (_err) { /* ignore */ }
    }
    console.error('Auto-backup failed:', e instanceof Error ? e.message : e);
    // Re-thrown so "Backup now" reports the failure instead of claiming success.
    throw e instanceof Error ? e : new Error('Auto-backup failed');
  }
}

export function shouldFireReminder(): boolean {
  const store = getSettingsStore();
  const config = store.get('backupReminder', DEFAULT_REMINDER) as BackupReminderConfig;
  return checkShouldFireReminder(config, new Date());
}

export function markReminderFired(): void {
  const store = getSettingsStore();
  const config = store.get('backupReminder', DEFAULT_REMINDER) as BackupReminderConfig;
  const todayStr = formatLocalDate(new Date());
  store.set('backupReminder', { ...config, lastRemindedDate: todayStr });
}

export function registerBackupIPC() {
  ipcMain.handle('backup:export', async () => {
    let tempDbPath: string | null = null;
    try {
      assertCurrentPermission('settings');
      const db = getDB();
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Full Backup (ZIP)',
        defaultPath: 'kitchen-pos-backup.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      });

      if (canceled || !filePath) {
        return { success: false, error: 'Export cancelled' };
      }

      tempDbPath = path.join(app.getPath('temp'), `pos-temp-${Date.now()}.db`);
      await db.backup(tempDbPath);

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(filePath);
        const createArchive = archiver as any;
        const archive = createArchive('zip', { zlib: { level: 9 } });
        output.on('close', () => { resolve(); });
        archive.on('error', (err: Error) => { reject(err); });
        
        archive.pipe(output);
        if (tempDbPath) {
          archive.file(tempDbPath, { name: 'pos.db' });
        }
        
        const imagesDir = path.join(app.getPath('userData'), 'images');
        if (fs.existsSync(imagesDir)) {
          archive.directory(imagesDir, 'images');
        }
        
        void archive.finalize();
      });

      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }

      return { success: true, data: filePath };
    } catch (e: unknown) {
      if (tempDbPath && fs.existsSync(tempDbPath)) {
        try { fs.unlinkSync(tempDbPath); } catch (_err) { /* ignore */ }
      }
      if (e instanceof Error) { return { success: false, error: e.message }; }
      return { success: false, error: 'Unknown error occurred' };
    }
  });

  ipcMain.handle('backup:import', async () => {
    let extractDir: string | null = null;
    try {
      assertCurrentPermission('settings');
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Full Backup (ZIP)',
        properties: ['openFile'],
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
      });

      if (canceled || filePaths.length === 0) {
        return { success: false, error: 'Import cancelled' };
      }

      const importedZip = filePaths[0];
      extractDir = path.join(app.getPath('temp'), `pos-extract-${Date.now()}`);
      
      await extractZip(importedZip, { dir: extractDir });

      const extractedDbPath = path.join(extractDir, 'pos.db');
      if (!fs.existsSync(extractedDbPath)) {
        return { success: false, error: 'Selected ZIP does not contain pos.db' };
      }

      const buffer = Buffer.alloc(16);
      const fd = fs.openSync(extractedDbPath, 'r');
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);

      if (!buffer.toString('utf8').startsWith('SQLite format 3')) {
        return { success: false, error: 'The pos.db inside the zip is not a valid SQLite database' };
      }

      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'pos.db');

      // closeDB() clears the cached handle. Calling db.close() directly left
      // the module-level singleton pointing at a closed connection, so every
      // later query threw "The database connection is not open" if anything
      // after this point failed and the relaunch never happened.
      closeDB();

      fs.copyFileSync(extractedDbPath, dbPath);

      // Copy images folder if it exists
      const extractedImagesDir = path.join(extractDir, 'images');
      const destImagesDir = path.join(userDataPath, 'images');
      if (fs.existsSync(extractedImagesDir)) {
        if (!fs.existsSync(destImagesDir)) {
          fs.mkdirSync(destImagesDir, { recursive: true });
        }
        const copyRecursiveSync = (src: string, dest: string) => {
          const exists = fs.existsSync(src);
          const stats = exists && fs.statSync(src);
          const isDirectory = exists && stats && stats.isDirectory();
          if (isDirectory) {
            if (!fs.existsSync(dest)) { fs.mkdirSync(dest); }
            fs.readdirSync(src).forEach(childItemName => {
              copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
            });
          } else {
            fs.copyFileSync(src, dest);
          }
        };
        copyRecursiveSync(extractedImagesDir, destImagesDir);
      }

      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (fs.existsSync(walPath)) { fs.unlinkSync(walPath); }
      if (fs.existsSync(shmPath)) { fs.unlinkSync(shmPath); }

      app.relaunch();
      app.quit();

      return { success: true };
    } catch (e: unknown) {
      if (e instanceof Error) { return { success: false, error: e.message }; }
      return { success: false, error: 'Unknown error occurred' };
    } finally {
      if (extractDir && fs.existsSync(extractDir)) {
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_err) { /* ignore */ }
      }
    }
  });

  ipcMain.handle('backup:getAutoBackupConfig', async () => {
    const store = getSettingsStore();
    return {
      success: true,
      data: {
        autoBackup: store.get('autoBackup', DEFAULT_AUTO_BACKUP) as AutoBackupConfig,
        backupReminder: store.get('backupReminder', DEFAULT_REMINDER) as BackupReminderConfig,
      }
    };
  });

  ipcMain.handle('backup:setAutoBackupConfig', async (_, payload: { autoBackup?: Partial<AutoBackupConfig>; backupReminder?: Partial<BackupReminderConfig> }) => {
    try {
      assertCurrentPermission('settings');
      const store = getSettingsStore();
      if (payload.autoBackup) {
        const current = store.get('autoBackup', DEFAULT_AUTO_BACKUP) as AutoBackupConfig;
        store.set('autoBackup', { ...current, ...payload.autoBackup });
      }
      if (payload.backupReminder) {
        const current = store.get('backupReminder', DEFAULT_REMINDER) as BackupReminderConfig;
        store.set('backupReminder', { ...current, ...payload.backupReminder });
      }
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('backup:selectAutoBackupPath', async () => {
    try {
      assertCurrentPermission('settings');
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Auto-Backup Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (canceled || filePaths.length === 0) { return { success: false, error: 'Cancelled' }; }
      return { success: true, data: filePaths[0] };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('backup:triggerNow', async () => {
    try {
      assertCurrentPermission('settings');
      // Forced: a manual "Backup now" must run even when the schedule is off
      // or a backup already ran today (previously it silently did nothing).
      const backupPath = await performAutoBackup({ force: true });
      return { success: true, data: backupPath };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
