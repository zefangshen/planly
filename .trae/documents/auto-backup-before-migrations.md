# Plan: Auto-backup DB before applying new migrations

## Summary

Add a safety-net backup step to `runMigrations` so historical data is never lost
when a schema migration runs. The backup fires **only when unapplied migrations
are pending** (not on every launch), to keep the data directory clean. It
snapshots the SQLite DB file right before Drizzle applies new migration SQL.

## Current State Analysis

- `runMigrations(db, migrationsFolder)` lives in
  [src/main/services/database-service.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/services/database-service.ts#L37-L44)
  and wraps Drizzle's `migrate()`. It has no `dbPath` param and no backup.
- Two call sites, both already have the DB path in scope:
  - Electron: [src/main/index.ts:23](file:///Users/zefang/Documents/career/airs/general/planly/src/main/index.ts#L23) — `dbPath` from `resolvePaths()` (line 12).
  - MCP server: [src/mcp/server.ts:37](file:///Users/zefang/Documents/career/airs/general/planly/src/mcp/server.ts#L37) — `DB_PATH` (line 30).
- Drizzle tracks applied migrations in a `__drizzle_migrations` table
  (columns: `id, hash, created_at, name, applied_at`), one row per applied
  migration. Migration files live as `<timestamp>_<name>/migration.sql` subfolders
  inside `migrationsFolder`.
- The DB runs in WAL mode (two processes share it), so a plain file copy alone
  could miss WAL-resident writes — a `PRAGMA wal_checkpoint(TRUNCATE)` is needed
  first to flush WAL into the main `.db` file.

## Proposed Changes

### 1. `src/main/services/database-service.ts` — add backup logic

Add three private helpers and update `runMigrations`:

- **`hasPendingMigrations(db, migrationsFolder): boolean`**
  - Query `SELECT COUNT(*) FROM __drizzle_migrations` inside a try/catch (table
    may not exist on a fresh DB → return `false`, no backup needed since there's
    no data to lose).
  - Count subdirectories in `migrationsFolder` that contain a `migration.sql`.
  - Return `true` only when local count > applied count.

- **`backupDb(db, dbPath): void`**
  - `db.exec('PRAGMA wal_checkpoint(TRUNCATE)')` — flush WAL into the main file.
  - `fs.copyFileSync(dbPath, backupPath)` where `backupPath =
    \`${dbPath}.backup-${isoTimestamp}\`` (colons/dots replaced with `-`).
  - Call `cleanupOldBackups(dbPath, 5)`.

- **`cleanupOldBackups(dbPath, keep): void`**
  - Read the directory, filter files matching `${basename}.backup-*`, sort
    descending (newest first), `fs.unlinkSync` everything beyond the first `keep`.

- **`runMigrations(db, migrationsFolder, dbPath?)`** — new optional third param:
  - If `dbPath` is provided, the file exists, AND `hasPendingMigrations` returns
    `true` → call `backupDb(db, dbPath)` before `migrate()`.
  - Then run the existing `migrate(drizzleDb, { migrationsFolder })` + the
    legacy `schema_migrations` drop as today.

The new imports needed: `fs` (already not imported in this file — add it) and
`path` (add it). Existing imports (`node:sqlite`, `crypto`, `drizzle`,
`migrate`) stay.

### 2. `src/main/index.ts` — pass dbPath

Change line 23 from:
```ts
runMigrations(db, sqlDir);
```
to:
```ts
runMigrations(db, sqlDir, dbPath);
```
`dbPath` is already destructured on line 12.

### 3. `src/mcp/server.ts` — pass DB_PATH

Change line 37 from:
```ts
runMigrations(db, SQL_DIR);
```
to:
```ts
runMigrations(db, SQL_DIR, DB_PATH);
```
`DB_PATH` is already defined on line 30.

## Assumptions & Decisions

- **Backup trigger:** only when `hasPendingMigrations` is true (user-confirmed).
  Rationale: avoids accumulating a backup on every routine launch.
- **Detection method:** compare local migration-folder count vs. row count in
  `__drizzle_migrations`. This is a safe over-approximation — if local >
  applied, there is definitely a new migration to apply. Edge cases:
  - Fresh DB (table missing): `hasPendingMigrations` returns `false` → no backup
    → correct (no data to lose on first migration).
  - All applied: equal counts → `false` → no backup → correct.
- **Retention:** keep the 5 most recent backups per DB path.
- **WAL safety:** `PRAGMA wal_checkpoint(TRUNCATE)` flushes all WAL pages into
  the main file and truncates `-wal`, so the file copy is a complete snapshot.
  `busy_timeout = 5000` (set in `openDb`) covers concurrent access from the
  other process during the checkpoint.
- **No new npm scripts** (e.g. a manual `db:backup` command). The user asked
  for the auto solution only; adding a manual CLI entry would be scope creep.
- **Backwards compatible:** `dbPath` is optional, so any future caller that
  omits it behaves exactly as today (no backup).

## Verification

1. **Typecheck:** `npm run typecheck` — confirms the new signature and
   call-site args compile.
2. **First-run (no pending migrations):** delete the dev `planly.db`, run
   `npm run dev`. The baseline migration applies, no backup is created
   (fresh DB → `hasPendingMigrations` returns false). Confirm no
   `*.backup-*` files appear next to `planly.db`.
3. **Pending-migration path:** add a column to
   [src/main/db/schema.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/db/schema.ts),
   run `npm run db:generate`, then `npm run dev`. Verify:
   - A `planly.db.backup-<timestamp>` file appears in the same dir as the DB.
   - Existing data (boards/columns/cards) survives the migration.
   - `__drizzle_migrations` has the new row.
4. **Idempotent re-launch:** restart the app (no new migration). No new backup
   file is created (all migrations already applied).
5. **Retention:** create 7 pending migrations + restarts (or manually create 7
   backup files). Confirm only the 5 newest remain after the next launch.
6. **MCP server path:** run `npm run mcp` with a pending migration present.
   Confirm a backup is also created when the MCP server runs migrations.
