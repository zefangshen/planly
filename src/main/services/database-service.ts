import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

export function uid(): string {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Open a Planly SQLite database with the standard pragmas.
 * WAL + busy_timeout allow the Electron app and MCP server processes to share one DB.
 */
export function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

// ---------------------------------------------------------------------------
// Migration runner (Drizzle)
// ---------------------------------------------------------------------------

const MAX_BACKUPS = 5;

/**
 * Apply Drizzle-managed SQL migrations from `migrationsFolder`.
 *
 * Drizzle reads `<folder>/<timestamp>_<name>/migration.sql` files, tracks
 * applied migrations in the `__drizzle_migrations` table, and skips ones
 * already recorded. The baseline migration uses `CREATE TABLE IF NOT EXISTS`
 * so it is a no-op on databases that already have the schema.
 *
 * When `dbPath` is provided and unapplied migrations are pending, the DB file
 * is backed up first (WAL checkpoint + file copy) so historical data can be
 * restored if a migration goes wrong. `migrate()` is synchronous for the
 * node:sqlite driver, matching the sync DatabaseSync usage in both the Electron
 * main process and the MCP server.
 */
export function runMigrations(db: DatabaseSync, migrationsFolder: string, dbPath?: string): void {
  if (dbPath && fs.existsSync(dbPath) && hasPendingMigrations(db, migrationsFolder)) {
    backupDb(db, dbPath);
  }

  const drizzleDb = drizzle({ client: db });
  migrate(drizzleDb, { migrationsFolder });

  // One-time cleanup: drop the legacy migration-tracking table from the
  // pre-Drizzle runner. Harmless if it doesn't exist.
  db.exec('DROP TABLE IF EXISTS schema_migrations');
}

/**
 * Detect whether the migrations folder contains more migration entries than
 * the DB has recorded in `__drizzle_migrations`. A fresh database (table
 * missing) returns false — there is no data to lose on the first migration.
 */
function hasPendingMigrations(db: DatabaseSync, migrationsFolder: string): boolean {
  let appliedCount = 0;
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number };
    appliedCount = row.c;
  } catch {
    // Table does not exist yet — fresh database, nothing to back up.
    return false;
  }

  let localCount = 0;
  for (const entry of fs.readdirSync(migrationsFolder)) {
    if (
      fs.statSync(path.join(migrationsFolder, entry)).isDirectory() &&
      fs.existsSync(path.join(migrationsFolder, entry, 'migration.sql'))
    ) {
      localCount++;
    }
  }

  return localCount > appliedCount;
}

/**
 * Snapshot the DB file before a destructive migration. WAL is checkpointed
 * first so the copy is a complete, self-contained snapshot of all committed
 * writes.
 */
function backupDb(db: DatabaseSync, dbPath: string): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.backup-${ts}`;
  fs.copyFileSync(dbPath, backupPath);
  cleanupOldBackups(dbPath, MAX_BACKUPS);
}

/**
 * Keep only the `keep` newest backup files for the given DB path, deleting
 * older ones so the data directory does not grow unbounded.
 */
function cleanupOldBackups(dbPath: string, keep: number): void {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.backup-`;
  const backups = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .sort()
    .reverse(); // newest first (ISO timestamps sort lexicographically)
  for (const f of backups.slice(keep)) {
    fs.unlinkSync(path.join(dir, f));
  }
}
