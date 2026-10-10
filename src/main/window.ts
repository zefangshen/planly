import { BrowserWindow, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { DATA_DIR, WINDOW_STATE_PATH } from './utils/paths';

// In dev, electron-vite serves the renderer and sets ELECTRON_RENDERER_URL.
const DEV_RENDERER_URL = process.env['ELECTRON_RENDERER_URL'];

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const WINDOW_DEFAULTS: WindowState = { width: 1200, height: 800, maximized: false };

function loadWindowState(): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8')) as Partial<WindowState>;
    const state: WindowState = { ...WINDOW_DEFAULTS, ...raw };
    // Drop stored position if it lands off every connected display
    if (typeof state.x === 'number' && typeof state.y === 'number') {
      const onScreen = screen.getAllDisplays().some(d =>
        state.x! >= d.workArea.x &&
        state.x! < d.workArea.x + d.workArea.width &&
        state.y! >= d.workArea.y &&
        state.y! < d.workArea.y + d.workArea.height
      );
      if (!onScreen) {
        delete state.x;
        delete state.y;
      }
    } else {
      delete state.x;
      delete state.y;
    }
    return state;
  } catch {
    return { ...WINDOW_DEFAULTS };
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = {
      width: win.getBounds().width,
      height: win.getBounds().height,
      maximized: win.isMaximized(),
    };
    if (!win.isMaximized() && !win.isMinimized()) {
      state.x = win.getBounds().x;
      state.y = win.getBounds().y;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state));
  } catch {
    // non-fatal: window state is best-effort
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

export function createWindow(): void {
  const state = loadWindowState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 900,
    minHeight: 600,
    title: 'Planly',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  if (state.maximized) win.maximize();

  // Persist window state (debounced for resize/move, immediate on close)
  let saveTimer: NodeJS.Timeout | undefined;
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 200);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', () => saveWindowState(win));
  win.on('unmaximize', () => saveWindowState(win));
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(win);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (DEV_RENDERER_URL) {
    win.loadURL(DEV_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}
