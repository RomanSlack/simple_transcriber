import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { closeRecordingSink, ensureStorageDirs, updateSession } from './storage';
import { initTheme } from './theme';
import { runRecoveryScan } from './recovery';
import { activeRecordings } from './active';

const isDev = process.env.NODE_ENV === 'development';

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
  // Best-effort: mark active recordings for recovery, then exit so the OS or
  // the user can restart.
  for (const id of activeRecordings) {
    try {
      closeRecordingSink(id).catch(() => undefined);
      // Leave status='recording' so recovery picks it up on next launch.
    } catch { /* ignore */ }
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    backgroundColor: '#EEF1F6',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 14 },
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../assets/icon-256.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const sendState = () =>
    win.webContents.send('window:state', {
      maximized: win.isMaximized(),
      focused: win.isFocused(),
    });
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('focus', sendState);
  win.on('blur', sendState);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Renderer crash → mark active recordings for recovery on next launch.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[fatal] render-process-gone:', details);
    for (const id of activeRecordings) {
      closeRecordingSink(id).catch(() => undefined);
      updateSession(id, { status: 'error', error: `Renderer crashed (${details.reason}). Audio preserved.` });
    }
    activeRecordings.clear();
  });

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  await ensureStorageDirs();
  initTheme();
  registerIpc(ipcMain);
  await createWindow();

  // Run recovery in the background — the window can render the recorder UI
  // immediately and a banner appears if anything is being recovered.
  runRecoveryScan().catch((err) => console.error('[recovery] scan failed:', err));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Flush active write streams so the WebM data is on disk.
  for (const id of activeRecordings) {
    closeRecordingSink(id).catch(() => undefined);
  }
});
