import { vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock the electron shell so services (and electron-store) load under plain node.
vi.mock('electron', () => {
  const userData = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pos-userdata-')), 'userData');
  fs.mkdirSync(userData, { recursive: true });
  return {
    app: {
      getPath: () => userData,
      whenReady: () => Promise.resolve(),
      isPackaged: false,
    },
    BrowserWindow: { getAllWindows: (): unknown[] => [] },
    ipcMain: { handle: () => undefined },
    dialog: {
      showSaveDialog: async () => ({ canceled: true }),
      showOpenDialog: async () => ({ canceled: true }),
    },
  };
});
