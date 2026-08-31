import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock the electron shell so services (and electron-store) load under plain node.
vi.mock('electron', () => {
  const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pos-userdata-')), 'userData');
  fs.mkdirSync(userData, { recursive: true });
  const mockApp = {
    getPath: () => userData,
    whenReady: () => Promise.resolve(),
    isPackaged: false,
    relaunch: () => undefined,
    exit: () => undefined,
  };
  const mockIpcMain = { handle: () => undefined, on: () => undefined };
  const mockDialog = {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true }),
  };
  const mockSession = {
    defaultSession: {
      webRequest: {
        onHeadersReceived: () => undefined,
      },
    },
  };
  const mockBrowserWindow = { getAllWindows: (): unknown[] => [] };
  const mockProtocol = { handle: () => undefined };
  const mockNet = { fetch: async () => undefined };

  const electronMock = {
    app: mockApp,
    BrowserWindow: mockBrowserWindow,
    ipcMain: mockIpcMain,
    dialog: mockDialog,
    session: mockSession,
    protocol: mockProtocol,
    net: mockNet,
  };

  return {
    __esModule: true,
    ...electronMock,
    default: electronMock,
  };
});
