import os from 'os';
import * as pty from 'node-pty';
import { app, BrowserWindow, IpcMain } from 'electron';
import { getResolvedEnv } from './shellEnv';

// Stamp every PTY this instance creates with its mode. Agents spawned inside
// the PTY (Claude, Codex, …) inherit it, and the MCP launcher reads
// PIXEL_CITY_INSTANCE before falling back to port-probing — so dev-spawned
// agents always route to dev's MCP servers, prod-spawned to prod's, even
// when both apps run simultaneously.
const PIXEL_CITY_INSTANCE = app.isPackaged ? 'prod' : 'dev';

const ptyProcesses = new Map<number, pty.IPty>();
let ptyIdCounter = 0;

function getDefaultShell(): string {
  switch (os.platform()) {
    case 'darwin':
      return 'zsh';
    case 'win32':
      return 'powershell.exe';
    default:
      return 'bash';
  }
}

interface PtyManagerDeps {
  getMainWindow: () => BrowserWindow | null;
}

export function register(ipcMain: IpcMain, deps: PtyManagerDeps) {
  ipcMain.handle('pty-create', async (_event, { cols, rows, command, args, cwd, env: extraEnv }: any) => {
    const id = ptyIdCounter++;
    const cmd = command || getDefaultShell();
    let cmdArgs = args || [];

    if (!command && (!args || args.length === 0)) {
      cmdArgs = ['-l'];
    }

    const resolvedEnv = await getResolvedEnv();
    const env = { ...resolvedEnv, ...(extraEnv || {}), PIXEL_CITY_INSTANCE };
    delete env.npm_config_prefix;

    const proc = pty.spawn(cmd, cmdArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || os.homedir(),
      env,
    });

    ptyProcesses.set(id, proc);

    proc.onData((data) => {
      const win = deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty-output', { id, data, process: proc.process });
      }
    });

    proc.onExit(({ exitCode }) => {
      ptyProcesses.delete(id);
      const win = deps.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('pty-exit', { id, exitCode });
      }
    });

    return id;
  });

  ipcMain.on('pty-input', (_event, { id, data }: { id: number; data: string }) => {
    const proc = ptyProcesses.get(id);
    if (proc) proc.write(data);
  });

  ipcMain.on('pty-resize', (_event, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
    const proc = ptyProcesses.get(id);
    if (proc) proc.resize(cols, rows);
  });

  ipcMain.on('pty-kill', (_event, { id }: { id: number }) => {
    const proc = ptyProcesses.get(id);
    if (proc) {
      proc.kill();
      ptyProcesses.delete(id);
    }
  });
}

export function killAll() {
  for (const [, proc] of ptyProcesses) {
    proc.kill();
  }
  ptyProcesses.clear();
}
