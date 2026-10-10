# Adopt Drizzle for DB Migrations — Implementation Plan

## Repository Research

**Current migration system** (custom runner in `src/main/services/database-service.ts`):
- Tracks applied migrations in a `schema_migrations` table (`id TEXT PK`, `applied_at TEXT`).
- Runs flat `.sql` files from `resources/migrations/` (id = filename) and JS migrations from `src/main/services/migrations/` registered in a `JS_MIGRATIONS` array.
- Existing migrations: `000_migrate_legacy_data` (JS), `001_initial.sql`, `002_add_archived_at.sql`, `003_seed_default_boards.sql`.
- Invoked on startup in both `src/main/index.ts` (Electron) and `src/mcp/server.ts` (MCP) via `runMigrations(db, sqlDir)`.

**Database layer**:
- Uses Node's built-in `node:sqlite` `DatabaseSync` (synchronous). All services (`board-service.ts`, `column-service.ts`, `card-service.ts`) use raw `db.prepare(...)` SQL — these stay as-is (out of scope; the request is migrations only).
- Pragmas: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000` to allow Electron + MCP processes to share one DB file.

**Schema** (after all existing migrations):
- `boards(id TEXT PK, title TEXT NOT NULL, position INTEGER NOT NULL)`
- `columns(id TEXT PK, board_id TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL, FK→boards ON DELETE CASCADE)`
- `cards(id TEXT PK, column_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '', due_date TEXT DEFAULT '', labels TEXT DEFAULT '[]', position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT DEFAULT NULL, FK→columns ON DELETE CASCADE)`

**Packaging**: `electron-vite` main process uses `externalizeDepsPlugin()` (externalizes all package.json deps). Project convention keeps all deps in `devDependencies` for a lean asar. Migration SQL files are shipped via `extraResources` (`resources/migrations` → `migrations`).

**Key Drizzle facts** (verified against published packages):
- `node:sqlite` (`DatabaseSync`) support is in the **1.0 RC** line: `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4`. Stable `0.45.x` does **not** have the `node-sqlite` driver.
- Runtime migrator: `import { migrate } from 'drizzle-orm/node-sqlite/migrator'` — `migrate(db, { migrationsFolder })` is **synchronous** (returns `void | MigratorInitFailResponse`), matching the sync `DatabaseSync` usage.
- `drizzle({ client: sqlite })` wraps an existing `DatabaseSync` into a drizzle instance without opening a second connection.
- `externalizeDepsPlugin({ exclude: ['drizzle-orm'] })` bundles `drizzle-orm` into the main-process output so the packaged app needs no runtime `node_modules` for it.

## Files and Modules

- `package.json`: add `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4` to `devDependencies`; add `db:generate` / `db:migrate` / `db:studio` scripts.
- `drizzle.config.ts` (new): `schema: './src/main/db/schema.ts'`, `out: './resources/migrations'`, `dialect: 'sqlite'`, `dbCredentials.url` → dev DB.
- `src/main/db/schema.ts` (new): Drizzle `sqliteTable` definitions for `boards`, `columns`, `cards` matching the current schema.
- `src/main/services/database-service.ts`: replace the custom `runMigrations` + `JS_MIGRATIONS` with a thin wrapper around drizzle's `migrate()`; keep `openDb` and `uid`.
- `src/main/services/seed.ts` (new): extract the `003` seed logic (default Career/Work/Life boards + sample cards, only when no boards exist) into a `seed(db)` function called after migrations.
- `src/main/services/legacy-bootstrap.ts` (new, or inline): extract the `000_migrate_legacy_data` logic into a `bootstrapLegacy(db)` pre-migration step.
- `src/main/services/migrations/000_migrate_legacy_data.ts`: delete (logic moved).
- `resources/migrations/001_initial.sql`, `002_add_archived_at.sql`, `003_seed_default_boards.sql`: delete (replaced by drizzle-generated baseline + seed function).
- `resources/migrations/0000_*/migration.sql` (new, generated): baseline CREATE TABLEs, edited to use `CREATE TABLE IF NOT EXISTS` so existing DBs are no-ops.
- `src/main/index.ts` / `src/mcp/server.ts`: update bootstrap to call `bootstrapLegacy` → `runMigrations` (drizzle) → `seed`.
- `src/main/utils/paths.ts`: `sqlDir` now points at the drizzle migrations folder (subfolder layout). Keep path the same; drizzle writes `resources/migrations/<timestamp>_<name>/migration.sql`.
- `electron.vite.config.ts`: `externalizeDepsPlugin({ exclude: ['drizzle-orm'] })` for the `main` build so the ORM is bundled into `out/main`.
- `.gitignore`: ensure generated `drizzle/meta` journal is committed (needed for `drizzle-kit generate`) but no stray artifacts.

## Implementation Steps

1. **Install dependencies.**
   `npm i -D drizzle-orm@1.0.0-rc.4 drizzle-kit@1.0.0-rc.4`
   (kept in `devDependencies` per project convention; `drizzle-orm` is bundled into the main build, `drizzle-kit` is dev-only.)

2. **Create Drizzle schema** at `src/main/db/schema.ts`:
   - `boards`: `text('id').primaryKey()`, `text('title').notNull()`, `integer('position').notNull()`
   - `columns`: `text('id').primaryKey()`, `text('board_id').notNull()`, `text('title').notNull()`, `integer('position').notNull()`, with `references(() => boards.id, { onDelete: 'cascade' })`
   - `cards`: `text('id').primaryKey()`, `text('column_id').notNull()`, `text('title').notNull()`, `text('description').default('')`, `text('due_date').default('')`, `text('labels').default("'[]'")`, `integer('position').notNull()`, `integer('archived').notNull().default(0)`, `text('archived_at')`, FK→columns on cascade.
   - Export tables so they are available for future typed queries (services still use raw SQL for now).

3. **Create `drizzle.config.ts`** at project root (dialect sqlite, schema + out as above).

4. **Generate baseline migration.**
   `npx drizzle-kit generate`
   This produces `resources/migrations/<ts>_<name>/migration.sql` with `CREATE TABLE` statements and a `meta/_journal.json`.

5. **Make the baseline idempotent for existing DBs.**
   Edit the generated `migration.sql`: change every `CREATE TABLE` to `CREATE TABLE IF NOT EXISTS`. (Existing databases already have these tables, so the baseline runs as a no-op and records itself in `__drizzle_migrations`.) This is the one-time transition trick and avoids manually seeding `__drizzle_migrations` hashes.

6. **Move seed data out of migrations** into `src/main/services/seed.ts` (`seed(db)`): recreate the `003` inserts (Career/Work/Life boards, columns, sample cards), all guarded by `NOT EXISTS` checks, run only when `SELECT COUNT(*) FROM boards` is 0.

7. **Move legacy migration** into `src/main/services/legacy-bootstrap.ts` (`bootstrapLegacy(db)`): the `000` logic (if `boards` empty but `columns` has rows, create a default board and attach orphaned columns). Runs **before** drizzle migrations.

8. **Replace the migration runner** in `database-service.ts`:
   - Remove `runMigrations`, `JS_MIGRATIONS`, the `schema_migrations` table creation, and the duplicate-column try/catch.
   - Add `runMigrations(db: DatabaseSync, migrationsFolder: string): void` that builds `const drizzleDb = drizzle({ client: db })` and calls `migrate(drizzleDb, { migrationsFolder })`.
   - Optionally drop the legacy `schema_migrations` table after the first successful drizzle run (one-time cleanup; guarded by `IF EXISTS`).
   - Keep `openDb` (with pragmas) and `uid` unchanged.

9. **Wire bootstrap** in `src/main/index.ts` and `src/mcp/server.ts`:
   ```
   bootstrapLegacy(db);      // pre-multi-board DB repair
   runMigrations(db, sqlDir); // drizzle
   seed(db);                 // default boards if empty
   ```
   MCP server keeps its own `SQL_DIR` resolution (project-root `resources/migrations`).

10. **Bundle drizzle-orm for the packaged Electron app.**
    In `electron.vite.config.ts`, change the `main` build to `externalizeDepsPlugin({ exclude: ['drizzle-orm'] })`. Preload/renderer unchanged.

11. **Clean up old migration files.**
    Delete `resources/migrations/001_initial.sql`, `002_add_archived_at.sql`, `003_seed_default_boards.sql`, and `src/main/services/migrations/000_migrate_legacy_data.ts` (and the now-empty `migrations/` dir).

12. **Add npm scripts.**
    - `db:generate`: `drizzle-kit generate`
    - `db:migrate`: `drizzle-kit migrate`
    - `db:studio`: `drizzle-kit studio`
    - `db:push`: `drizzle-kit push` (dev convenience)

13. **Update `.gitignore`** if needed (drizzle `meta/_journal.json` must be committed; `drizzle/*.db` / `*.db-journal` should stay ignored).

14. **Update project memory** conventions: migrations now live in `resources/migrations/` as drizzle-managed subfolders; schema is the source of truth in `src/main/db/schema.ts`; use `drizzle-kit generate` after schema changes.

## Dependencies and Considerations

- **Drizzle 1.0 RC**: `node:sqlite` support is RC-only as of now. Pin to `1.0.0-rc.4` for both `drizzle-orm` and `drizzle-kit`. When 1.0 stable ships, bump together.
- **Sync migrator**: `drizzle-orm/node-sqlite/migrator`'s `migrate()` is synchronous — fits the existing sync bootstrap in both Electron and MCP entry points (no async restructuring needed).
- **Bundling**: `drizzle-orm` must be bundled into the Electron main build (via `exclude` in `externalizeDepsPlugin`) because the packaged app ships no `node_modules`. The MCP server (run from source via `tsc`) relies on `node_modules` being present — consistent with its existing `zod`/`@modelcontextprotocol/sdk` usage.
- **Migration folder layout change**: drizzle writes `<folder>/<ts>_<name>/migration.sql` (subfolders), not flat `.sql` files. The runtime `migrate()` expects this layout. `extraResources` still copies the whole `resources/migrations` folder, so packaging is unaffected.
- **Existing DB transition**: relies on `CREATE TABLE IF NOT EXISTS` in the hand-edited baseline. This means on an already-migrated DB, the baseline is a no-op and gets recorded in `__drizzle_migrations`. The old `schema_migrations` table is left in place (or dropped) — harmless.
- **Seed is not a migration**: default boards/sample cards are application seed data, not schema. Moved to a `seed()` call that runs after every migration pass (guarded by "no boards exist" so it never overwrites user data).
- **Services unchanged**: the service layer continues to use raw `node:sqlite` SQL. The Drizzle schema is the source of truth for the schema shape and future migration generation, but query code is not rewritten (out of scope).

## Validation

- `npm run typecheck` passes (tsconfig.json + tsconfig.web.json).
- `npm run build` succeeds; `out/main/index.js` contains bundled drizzle-orm code (no `require('drizzle-orm')` leak).
- Fresh DB: delete `planly.db`, run `npm run dev` (or start the MCP server) — verify tables created, default boards seeded, app loads.
- Existing DB: keep the current `planly.db`, start the app — verify no errors, schema unchanged, `__drizzle_migrations` has the baseline recorded, `boards`/`columns`/`cards` intact.
- `npx drizzle-kit generate` runs cleanly with no pending diff (schema matches DB).
- `npx drizzle-kit studio` opens and shows the 3 tables.
- MCP server: `npm run build:mcp && npm run mcp` starts, applies migrations (no-op on existing DB), and tools work.
- `npm run package` produces a working `Planly.app` that opens an existing DB without migration errors.

## Risks

- **RC instability**: Drizzle 1.0 RC may have API changes before stable. Mitigation: pin exact versions; the surface used (schema + `migrate()`) is small and stable across recent RCs.
- **Baseline hash mismatch after hand-edit**: editing the generated `migration.sql` changes its content hash, but drizzle records the hash of the file as-is, so subsequent `generate` diffs still work (journal snapshot reflects the edited SQL). Risk: future `generate` might try to "fix" the `IF NOT EXISTS` back to plain `CREATE TABLE`. Mitigation: after editing, run `drizzle-kit generate` once more to confirm no diff is produced; if it rewrites, re-apply `IF NOT EXISTS`. (Low risk since the baseline is a one-shot.)
- **`externalizeDepsPlugin` exclude semantics**: verified in `node_modules/electron-vite/dist/index.mjs` that `exclude` removes a dep from the external list (i.e., bundles it). If a future electron-vite changes this, fall back to `build.rollupOptions.external` manually excluding `drizzle-orm`.
- **Two processes migrating concurrently**: Electron and MCP both call `migrate()` on the same WAL DB. Drizzle's `migrate()` wraps each migration in a transaction and uses `__drizzle_migrations`. With `busy_timeout=5000`, concurrent runs serialize. Risk is low (existing custom runner had the same property and worked).
- **Legacy DB edge case**: pre-multi-board DBs with `columns` but empty `boards` — handled by `bootstrapLegacy` before drizzle runs. If a legacy DB somehow lacks the `boards` table entirely, the baseline `CREATE TABLE IF NOT EXISTS boards` creates it, then `bootstrapLegacy` is a no-op (boards count 0 but columns also 0). Acceptable.
