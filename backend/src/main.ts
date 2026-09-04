import { app, BrowserWindow, Menu, Tray, nativeImage, protocol, net, session, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { runMigrations } from './db/migrate';
import { getDB, closeDB } from './db';
import { startScheduler } from './scheduler';
import { registerOrdersIPC } from './ipc/orders';
import { registerMenuIPC } from './ipc/menu';
import { registerTablesIPC } from './ipc/tables';
import { registerBillingIPC } from './ipc/billing';
import { registerInventoryIPC } from './ipc/inventory';
import { registerStaffIPC } from './ipc/staff';
import { registerReportsIPC } from './ipc/reports';
import { registerBackupIPC } from './ipc/backup';
import { registerSettingsIPC } from './ipc/settings';
import { registerPrinterIPC } from './ipc/printer';
import { registerKDSIPC } from './ipc/kds';
import { registerCashIPC as registerShiftsIPC } from './ipc/cash';
import { registerExpensesIPC } from './ipc/expenses';
import { registerCustomersIPC } from './ipc/customers';
import { registerDashboardIPC } from './ipc/dashboard';
import { registerBusinessSessionIPC } from './ipc/business-session';
import { registerSystemIPC } from './ipc/system';
import { registerPaymentsIPC } from './ipc/payments';
import { registerStage2IPC } from './ipc/stage2';
import { registerSuppliersIPC } from './ipc/suppliers';
import { registerAuditIPC } from './ipc/audit';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * Resolve a bundled asset both in development (repo layout) and inside a
 * packaged app (asar / resources). The first path that exists wins.
 */
function resolveAssetPath(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) { return candidate; }
    } catch { /* unreadable path — try the next candidate */ }
  }
  return null;
}

function appIconPath(): string | null {
  return resolveAssetPath(
    path.join(process.resourcesPath, 'assets', 'icon.png'),
    path.join(__dirname, '../../assets/icon.png'),
    path.join(__dirname, '../../../assets/icon.png'),
    path.join(app.getAppPath(), 'assets', 'icon.png'),
  );
}

function trayIconPath(): string | null {
  return resolveAssetPath(
    path.join(process.resourcesPath, 'assets', 'tray-icon.png'),
    path.join(__dirname, '../../assets/tray-icon.png'),
    path.join(__dirname, '../../../assets/tray-icon.png'),
    path.join(app.getAppPath(), 'assets', 'tray-icon.png'),
  );
}

async function createWindow() {
  const iconPath = appIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#053723',
    title: 'S Restaurant — Kitchen POS',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Avoid a white flash while the renderer boots.
  mainWindow.once('ready-to-show', () => { mainWindow?.show(); });

  // Never let the renderer navigate away or spawn app windows; external links
  // open in the user's real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { void shell.openExternal(url); }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer = url.startsWith('http://localhost:5205');
    if (!isDevServer && !url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) { void shell.openExternal(url); }
    }
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

  if (isDev) {
    process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
    void mainWindow.loadURL('http://localhost:5205');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }

  // Surface load failures instead of leaving the user on a blank window.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Renderer failed to load (${errorCode} ${errorDescription}): ${validatedURL}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) { mainWindow.restore(); }
    mainWindow.show();
    mainWindow.focus();
  } else {
    void createWindow();
  }
}

/**
 * System-tray entry. Windows refuses to create a Tray from an empty image and
 * throws, which previously took the whole main process down at startup, so the
 * icon is resolved from disk first and the tray is skipped when unavailable.
 */
function createTray(): void {
  try {
    const iconPath = trayIconPath();
    if (!iconPath) {
      console.warn('Tray icon asset not found — running without a tray icon.');
      return;
    }
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    if (trayIcon.isEmpty()) {
      console.warn('Tray icon could not be decoded — running without a tray icon.');
      return;
    }

    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open S Restaurant POS', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit(); } },
    ]);
    tray.setToolTip('S Restaurant — Kitchen POS');
    tray.setContextMenu(contextMenu);
    tray.on('click', showMainWindow);
  } catch (e) {
    console.error('Tray unavailable:', e instanceof Error ? e.message : e);
  }
}

function registerAllIPC() {
  registerOrdersIPC();
  registerMenuIPC();
  registerTablesIPC();
  registerBillingIPC();
  registerInventoryIPC();
  registerStaffIPC();
  registerReportsIPC();
  registerBackupIPC();
  registerSettingsIPC();
  registerPrinterIPC();
  registerKDSIPC();
  registerShiftsIPC();
  registerExpensesIPC();
  registerCustomersIPC();
  registerDashboardIPC();
  registerBusinessSessionIPC();
  registerSystemIPC();
  registerPaymentsIPC();
  registerStage2IPC();
  registerSuppliersIPC();
  registerAuditIPC();
}

void app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' local: blob: data:; img-src 'self' data: local: blob:;"],
      },
    });
  });

  // ── local:// image protocol ──────────────────────────────────────────
  // Menu images are copied into <userData>/images and referenced as
  // `local://<absolute path>`. Two problems had to be solved here:
  //   1. Windows paths ("C:\\Users\\...") are mangled when parsed as a URL
  //      authority, so the previous `file://` + slice approach never resolved
  //      and dish images silently failed to render.
  //   2. Slicing the scheme off and fetching it verbatim let the renderer read
  //      *any* file on disk through this protocol.
  // Both are fixed by resolving strictly inside the images directory.
  protocol.handle('local', async (request) => {
    try {
      const imagesDir = path.join(app.getPath('userData'), 'images');
      const raw = decodeURIComponent(request.url.slice('local://'.length))
        .replace(/^\/+/, '')
        .replace(/\\/g, '/');
      const fileName = path.basename(raw);
      if (!fileName || fileName === '.' || fileName === '..') {
        return new Response('Not found', { status: 404 });
      }
      const resolved = path.resolve(imagesDir, fileName);
      if (path.relative(imagesDir, resolved).startsWith('..')) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(resolved)) {
        return new Response('Not found', { status: 404 });
      }
      return await net.fetch(pathToFileURL(resolved).toString());
    } catch (e) {
      console.error('local:// protocol error:', e instanceof Error ? e.message : e);
      return new Response('Internal error', { status: 500 });
    }
  });

  // Initialize DB and Run migrations before registering IPC
  getDB();
  runMigrations();

  registerAllIPC();
  startScheduler();

  void createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Closing the last window quits the app (except on macOS). The tray only
  // keeps the process alive while a window is still open.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (tray && !tray.isDestroyed()) { tray.destroy(); }
  closeDB();
});

// A POS must never end up with two processes writing the same SQLite file.
// The second launch hands focus back to the running instance and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { showMainWindow(); });
}

// Never let an unexpected error kill the till mid-service silently.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in main process:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in main process:', reason);
});
