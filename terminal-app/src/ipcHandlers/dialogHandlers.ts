import path from 'path';
import { BrowserWindow, dialog, Notification, IpcMain } from 'electron';

let settingsWindow: BrowserWindow | null = null;

interface DialogDeps {
  getMainWindow: () => BrowserWindow | null;
}

export function register(ipcMain: IpcMain, deps: DialogDeps) {
  // --- Settings window ---

  ipcMain.handle('open-settings-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }

    const mainWindow = deps.getMainWindow();

    settingsWindow = new BrowserWindow({
      width: 640,
      height: 500,
      minWidth: 420,
      minHeight: 300,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      title: 'Pixel City - Settings',
      backgroundColor: '#0a0a0c',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
      settingsWindow.loadURL(`${devUrl}/settings.html`);
    } else {
      settingsWindow.loadFile(path.join(__dirname, '../../renderer/settings.html'));
    }

    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
  });

  // Forward settings changes to the main window so terminals update live
  ipcMain.on('settings-changed', (_event, data) => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-changed', data);
    }
  });

  // --- System notifications ---

  ipcMain.handle('send-notification', (_event, { title, body }: { title: string; body: string }) => {
    if (!Notification.isSupported()) return;
    const notif = new Notification({ title, body });
    notif.show();
  });

  // --- File/folder dialogs ---

  ipcMain.handle('open-folder-dialog', async (_event) => {
    const win = deps.getMainWindow() ?? BrowserWindow.fromWebContents(_event.sender) ?? undefined;
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('open-file-dialog', async (_event, options: any) => {
    const win = deps.getMainWindow() ?? BrowserWindow.fromWebContents(_event.sender) ?? undefined;
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: options?.filters || [],
      title: options?.title || 'Select File',
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0];
  });
}
