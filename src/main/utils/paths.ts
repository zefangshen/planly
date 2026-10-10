import { app } from 'electron';
import path from 'path';

// Shared data dir (packaged): deterministic lowercase dir so the MCP server
// resolves the same DB path. Dev keeps the project-root DB.
export const DATA_DIR = path.join(app.getPath('appData'), 'planly');
export const WINDOW_STATE_PATH = path.join(DATA_DIR, 'window-state.json');

export function resolvePaths(): { dbPath: string; sqlDir: string; legacyDb: string | null } {
  if (app.isPackaged) {
    return {
      dbPath: path.join(DATA_DIR, 'planly.db'),
      sqlDir: path.join(process.resourcesPath, 'migrations'),
      legacyDb: path.join(process.resourcesPath, 'planly.db'),
    };
  }
  // Bundled main lives at out/main/index.js → project root is two levels up
  const projectRoot = path.resolve(__dirname, '..', '..');
  return {
    dbPath: path.join(projectRoot, 'planly.db'),
    sqlDir: path.join(projectRoot, 'resources', 'migrations'),
    legacyDb: null,
  };
}
