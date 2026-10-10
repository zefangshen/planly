import { app, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { openDb, runMigrations } from './services/database-service';
import { bootstrapLegacy } from './services/legacy-bootstrap';
import { seed } from './services/seed';
import { registerIpc } from './ipc';
import { createWindow } from './window';
import { resolvePaths } from './utils/paths';

app.whenReady().then(() => {
  // Dev-only dock icon: the packaged app uses the bundle .icns instead.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'));
    if (!icon.isEmpty() && app.dock) app.dock.setIcon(icon);
  }

  const { dbPath, sqlDir, legacyDb } = resolvePaths();

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // One-time adoption of a bundled legacy DB (packaged builds only)
  if (legacyDb && !fs.existsSync(dbPath) && fs.existsSync(legacyDb)) {
    fs.copyFileSync(legacyDb, dbPath);
  }

  const db = openDb(dbPath);
  bootstrapLegacy(db);
  runMigrations(db, sqlDir, dbPath);
  seed(db);

  registerIpc(db);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
