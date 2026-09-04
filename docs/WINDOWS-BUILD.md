# Running S Restaurant POS on Windows

There are two Windows builds:

| Build | File | Use it when |
| --- | --- | --- |
| Installer (NSIS) | `S-Restaurant-POS-Setup-1.0.0.exe` | Normal install with Start-menu and desktop shortcuts, choosable install folder, uninstall entry. |
| Portable | `S-Restaurant-POS-1.0.0-portable.exe` | Run straight from a USB stick or a folder, no installation. |

Both are 64-bit and fully offline — the app never needs an internet connection.

## Getting the executables

The build machine must be Windows, because `better-sqlite3` is a native module
that has to be compiled for Windows and for Electron's ABI. The repository ships
a GitHub Actions workflow that does exactly that.

1. Open the repository on GitHub → **Actions**.
2. Select **Build S Restaurant POS for Windows** in the left sidebar.
3. Click **Run workflow**, choose the branch, and confirm.
4. When the run finishes (roughly 15–25 minutes), open it and download the
   **S-Restaurant-POS-Windows** artifact from the *Artifacts* section.
5. Unzip it — it contains both executables.

## Installing

Windows SmartScreen will warn that the publisher is unknown, because the build
is not code-signed. Choose **More info → Run anyway**. To remove the warning
permanently you need an Authenticode code-signing certificate; add it to the
workflow as the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets and electron-builder
will sign the output automatically.

## First run

1. Launch **S Restaurant POS**.
2. The setup screen asks for the restaurant name, the admin name and a 4–10
   digit admin PIN.
3. You are prompted to **save a recovery code file** first. Keep it safe — it is
   the only way to reset the admin PIN, and setup will not complete without it.
4. Log in with the admin PIN and open a cash shift to start taking orders.

## Where your data lives

Everything is stored locally in the Windows user profile:

```
%APPDATA%\S Restaurant POS\
├── pos.db        SQLite database (orders, menu, bills, inventory, staff)
├── config.json   Settings, including the auto-backup schedule
└── images\       Uploaded dish photos
```

The portable executable uses the same location, so the installed and portable
builds share one database on the same machine.

### Backups

- **Settings → Backup** exports a `.zip` containing `pos.db` and the images.
- Auto-backup can be scheduled daily or weekly; it now runs on the next launch
  if the PC was switched off at the scheduled time, and keeps the 7 most recent
  archives.
- **Import** restores a backup and restarts the app.

## Building it yourself on Windows

Requirements: Node.js 22, Python 3.12, and Visual Studio 2022 Build Tools with
the "Desktop development with C++" workload.

```powershell
npm install                 # rebuilds better-sqlite3 for Electron automatically
npm install --prefix backend
npm install --prefix frontend

npm run verify              # lint + tests + build
npm run package:win         # installer + portable exe in dist-electron\
```

To run the app in development instead:

```powershell
npm run dev
```

## Troubleshooting

**"The specified module could not be found" / NODE_MODULE_VERSION errors**
`better-sqlite3` was built for the wrong runtime. Run `npm run rebuild` in the
repository root (rebuilds for Electron) — the backend test suite repairs its own
copy for Node automatically.

**The window opens blank**
Check the terminal output; the main process logs `Renderer failed to load` with
the underlying reason. In a packaged build this usually means `frontend/dist`
was missing at package time — run `npm run build` before `electron-builder`.

**A second window will not open**
That is intentional. The app holds a single-instance lock so two processes can
never write to the same SQLite file; launching it again focuses the running
window.
