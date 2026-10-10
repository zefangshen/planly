# Plan: Migrate Planly to Electron + MCP Server

## Summary

Convert Planly from a web app (Express + `node:sqlite` + React SPA) into a desktop app:

1. **Electron shell** — native window, renderer loads the existing React client, data access via IPC through a preload bridge (no HTTP server).
2. **MCP server (stdio)** — exposes Planly's board/column/card operations as 14 tools so AI agents (Claude Code, Codex, Cursor, Trae) can read and write the same SQLite database.
3. **Shared core** — all domain logic extracted from `src/server.ts` into transport-free modules used by both IPC handlers and MCP tools. Express is removed.

Confirmed decisions (from prior discussion): UI bridge = **IPC via preload**; MCP transport = **stdio only**; Express = **removed**.

## Current State Analysis

| Area | File(s) | Facts |
|---|---|---|
| Backend | [src/server.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/server.ts) | 578 lines: Express routes + inline SQL handlers, `node:sqlite` `DatabaseSync`, WAL + FK pragmas, migration runner (SQL from `migrations/`, JS from `dist/migrations/`), static SPA serving |
| Migrations | [migrations/001_initial.sql](file:///Users/zefang/Documents/career/airs/general/planly/migrations/001_initial.sql), `002_add_archived_at.sql`, `003_seed_default_boards.sql`; [src/migrations/000_migrate_legacy_data.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/migrations/000_migrate_legacy_data.ts) | SQL files at project root; one JS migration loaded via `require()` at runtime; tracked in `schema_migrations` table |
| DB | `planly.db` (+`-shm`/`-wal`) at project root | Dev database, WAL mode |
| Client | `client/` — Vite 5 + React 18 + `@hello-pangea/dnd` | Builds to `../public`; Vite dev proxies `/api` → `localhost:3000` |
| API layer | [client/src/api.ts](file:///Users/zefang/Documents/career/airs/general/planly/client/src/api.ts) | 14 fetch-based methods (`getBoards`, `getBoard`, `createColumn`, `renameColumn`, `deleteColumn`, `moveColumn`, `archiveAllCards`, `createCard`, `updateCard`, `moveCard`, `deleteCard`, `archiveCard`, `getArchivedCards`, `restoreCard`) |
| State restore | [client/src/hooks/useBoard.ts](file:///Users/zefang/Documents/career/airs/general/planly/client/src/hooks/useBoard.ts), [App.tsx](file:///Users/zefang/Documents/career/airs/general/planly/client/src/App.tsx), [useTheme.ts](file:///Users/zefang/Documents/career/airs/general/planly/client/src/hooks/useTheme.ts) | Active board, active view, and theme already persisted in renderer `localStorage` — works unchanged inside Electron |
| Root config | [package.json](file:///Users/zefang/Documents/career/airs/general/planly/package.json), [tsconfig.json](file:///Users/zefang/Documents/career/airs/general/planly/tsconfig.json) | `"main": "dist/server.js"`; tsc CommonJS, `rootDir: ./src`, `outDir: ./dist`; deps: `express` only |

## Target Architecture

```
planly/
├── src/
│   ├── core/                  # transport-free domain logic (new)
│   │   ├── db.ts              # openDb(), pragmas (WAL, FK, busy_timeout), migration runner
│   │   ├── types.ts           # request/response + DB row types (from server.ts)
│   │   ├── boards.ts          # listBoards, getBoard
│   │   ├── columns.ts         # createColumn, renameColumn, deleteColumn, moveColumn, archiveAllCards
│   │   └── cards.ts           # createCard, updateCard, moveCard, deleteCard, setCardArchived, listArchivedCards
│   ├── main/                  # Electron main process (new)
│   │   ├── index.ts           # app lifecycle, BrowserWindow, window-state persistence, DB bootstrap
│   │   └── ipc.ts             # ipcMain.handle registrations → core functions
│   ├── preload.ts             # contextBridge → window.planly (new)
│   └── mcp/
│       └── server.ts          # stdio MCP server → core functions (new)
├── migrations/                # unchanged (SQL)
├── client/                    # stays at root (decision 9) — own package.json/tsconfig
│   ├── src/api.ts             # rewritten: window.planly bridge, same method names/signatures
│   ├── vite.config.ts         # add base: './'
│   └── ...                    # all components/hooks unchanged
└── package.json               # main entry, electron deps, scripts, electron-builder config
```

## Proposed Changes

### Step 1 — Extract shared core (`src/core/`)

Move the route-handler bodies out of `src/server.ts` into core modules. Each current handler becomes one exported function with identical SQL and validation (throw `Error('Title required')` / `Error('Board not found')` etc. instead of `res.status(400)`).

- **[src/core/types.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/core/types.ts)** (new) — move `BoardSummary`, `Card`, `Column`, `BoardResponse`, `ArchivedCardResponse` and all `*Row`/`*Body` interfaces from server.ts lines 11–114.
- **[src/core/db.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/core/db.ts)** (new) — from server.ts lines 116–218:
  - `openDb(dbPath: string): DatabaseSync` — opens, sets `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, **plus `PRAGMA busy_timeout = 5000`** (new: needed for concurrent MCP + app access).
  - `runMigrations(db, opts: { sqlDir: string; jsDir?: string })` — same merge-and-sort logic, but the JS migration `000_migrate_legacy_data.ts` becomes a **static import** (`import migrateLegacyData from '../migrations/000_migrate_legacy_data'`) instead of runtime `require()`, so it works inside an asar archive. Keep the `schema_migrations` bookkeeping and the duplicate-column skip logic.
- **[src/core/boards.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/core/boards.ts)**, **columns.ts**, **cards.ts** (new) — one function per operation, each taking `(db, ...args)`. Signatures mirror the REST responses 1:1 (e.g. `getBoard(db, id): BoardResponse`, `archiveAllCards(db, colId): { ok, archivedCount }`).
- **src/server.ts** — temporarily rewritten to be a thin shell: `app.get('/api/boards', ...)` → `res.json(listBoards(db))` for all routes. This proves the extraction is behavior-identical before anything else changes.

**Verify:** `npm run build:all && npm start` — existing web app works exactly as before.

### Step 2 — Electron main + preload + IPC

- **[src/main/index.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/index.ts)** (new):
  - Create `BrowserWindow` (1200×800 min 900×600) with `webPreferences: { preload, contextIsolation: true, nodeIntegration: false }`.
  - Load `http://localhost:5173` when `PLANLY_DEV=1`, else `file://` → `public/index.html` (Vite must emit with `base: './'`).
  - **DB path resolution:** dev → `<projectRoot>/planly.db` (keeps existing data); packaged → `app.getPath('userData')/planly.db`, with one-time copy from the bundled legacy DB if present. `runMigrations` on startup, `sqlDir` = `<projectRoot>/migrations` in dev, `process.resourcesPath/migrations` packaged (via `extraResources`).
  - **Window-state persistence:** save `{ bounds, maximized }` to `userData/window-state.json` on close/resize/maximize; restore on launch (no extra dependency). Renderer `localStorage` already restores active board/view/theme — no changes needed there.
  - Quit fully on `window-all-closed` (including macOS, since there is no menu-bar paradigm here).
- **[src/main/ipc.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/ipc.ts)** (new) — one channel per API method, each calling a core function:
  `boards:list`, `boards:get`, `columns:create`, `columns:rename`, `columns:delete`, `columns:move`, `columns:archiveAll`, `cards:create`, `cards:update`, `cards:move`, `cards:delete`, `cards:archive`, `cards:archived:list`.
  Core `Error` throws reject the invoke promise → renderer receives `Error.message` (matches current `api.ts` error handling).
- **[src/preload.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/preload.ts)** (new) — `contextBridge.exposeInMainWorld('planly', { getBoards: () => ipcRenderer.invoke('boards:list'), ... })` with the **same 14 method names and signatures** as today's `api` object.
- **[client/src/api.ts](file:///Users/zefang/Documents/career/airs/general/planly/client/src/api.ts)** — replace fetch `request()` with:
  ```ts
  export interface PlanlyApi { getBoards(): Promise<{ boards: Board[] }>; /* 14 signatures, same as today */ }
  declare global { interface Window { planly: PlanlyApi } }
  export const api: PlanlyApi = window.planly;
  ```
  Call sites in hooks/components unchanged.
- **[client/vite.config.ts](file:///Users/zefang/Documents/career/airs/general/planly/client/vite.config.ts)** — add `base: './'`; keep the dev proxy block only while Express parity exists, then remove in Step 4.
- **[package.json](file:///Users/zefang/Documents/career/airs/general/planly/package.json)** — `"main": "dist/main/index.js"`; add devDeps `electron@^37` (≥ Node 22.16 so `node:sqlite` `DatabaseSync` is available without flags — **hard requirement**), `wait-on`; scripts:
  - `dev`: `concurrently "tsc --watch" "cd client && npm run dev" "wait-on tcp:5173 && PLANLY_DEV=1 electron ."`
  - `start`: `electron .` (after build)
- tsc output layout is automatic: `rootDir ./src` + subfolders → `dist/main/`, `dist/core/`, `dist/preload.js`, `dist/mcp/`.

**Verify:** `npm run dev` — Electron window opens, board loads over IPC, drag-and-drop, archive, theme toggle, board switching all work; relaunch restores window bounds and last board/view.

### Step 3 — MCP server (stdio)

- **[src/mcp/server.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/mcp/server.ts)** (new) — `@modelcontextprotocol/sdk` + `zod`:
  - DB path: `PLANLY_DB` env var, else Electron's `userData` path (hardcode-free: resolve `app.getPath('userData')` equivalent — `~/Library/Application Support/planly/planly.db` on macOS) so the MCP process shares the app's DB. Runs `openDb` + `runMigrations` itself (idempotent via `schema_migrations`).
  - 14 tools with zod input schemas, each handler → core function, result serialized as JSON text content. Tool names: `list_boards`, `get_board`, `create_column`, `rename_column`, `delete_column`, `move_column`, `archive_all_cards`, `create_card`, `update_card`, `move_card`, `delete_card`, `archive_card`, `restore_card`, `list_archived_cards`.
  - Errors from core caught → MCP `isError` responses with the message.
  - Transport: `StdioServerTransport`; never `console.log` to stdout (logging goes to stderr).
- **package.json** — add deps `@modelcontextprotocol/sdk`, `zod`; script `"mcp": "node dist/mcp/server.js"`.
- Agent registration example (documented in plan output, not a file):
  ```json
  { "mcpServers": { "planly": { "command": "node", "args": ["/abs/path/planly/dist/mcp/server.js"] } } }
  ```
- **Concurrency note:** WAL + `busy_timeout=5000` covers app ↔ MCP simultaneous access. Writes from an agent appear in the UI on next board load/refresh; cross-process push (`webContents.send`) is **out of scope** — note as known limitation.
- **src/server.ts** is now deleted along with its routes (the parity shell from Step 1 has served its purpose).

**Verify:** `npx @modelcontextprotocol/inspector node dist/mcp/server.js` — call `list_boards`, `create_card`, verify in the Electron UI after refresh. Also test MCP write while the app is open (WAL concurrency).

### Step 4 — Cleanup

- Remove `express`, `@types/express` from package.json; remove `concurrently` proxy line for `/api` in vite.config.ts; delete stale `dist/server.js` via clean build.
- `"main"` stays `dist/main/index.js`; `npm run build` = `tsc`, `npm run build:client` unchanged.

### Step 5 — Packaging (electron-builder)

- Add devDep `electron-builder`; `package.json` `"build"` config:
  - `appId: com.planly.app`, `productName: Planly`, mac target `dmg` (dir build for testing).
  - `files`: `dist/**`, `public/**`, `package.json`.
  - `extraResources`: `{ from: "migrations", to: "migrations" }` — SQL migrations readable at `process.resourcesPath/migrations` (outside asar).
- Script `"package": "npm run build:all && electron-builder --dir"` for an unpacked smoke test; `"dist"` for dmg.
- JS migration ships compiled inside `dist/` (safe in asar thanks to Step 1's static import).

**Verify:** `npm run package` → launch unpacked app → fresh `userData` DB is created and migrated (seed boards appear from `003_seed_default_boards.sql`); MCP server pointed at the packaged DB path works.

## Assumptions & Decisions

1. **IPC via preload** — decided; no embedded Express.
2. **stdio-only MCP** — decided; no HTTP transport.
3. **Express removed** — decided; Step 1 keeps it temporarily only as a parity harness.
4. **Electron ≥ 37** required for `node:sqlite` (bundled Node ≥ 22.16). No `better-sqlite3` fallback needed; if Electron version must drop later, `core/db.ts` is the single swap point.
5. **Migrations mechanism preserved** (SQL dir + one JS migration) rather than converting `000` to SQL — it must no-op on fresh DBs and only fire on pre-`001` legacy schemas; the existing JS logic handles that exactly.
6. **Cross-process live updates** (MCP write → UI push) deferred; refresh-on-load is acceptable.
7. **Renderer `localStorage` state** (active board, view, theme) carries over untouched — satisfies the "restore last open tab" behavior.
8. Packaging target: macOS (dmg) only, per current platform.
9. **`client/` stays at root** — confirmed with user. It remains a self-contained Vite project with its own `package.json`/`tsconfig.json`/`node_modules`; no restructuring into `src/renderer/`. Server-side code (main/preload/core/mcp) lives under `src/` only.

## Verification Checklist

- [ ] `npm run build:all` compiles clean (Step 1 parity: web app still works via temporary Express shell)
- [ ] `npm run dev` — Electron window: board CRUD, drag-and-drop, archive/restore, theme, board switching
- [ ] Relaunch: window bounds + last board/view restored
- [ ] `npx @modelcontextprotocol/inspector node dist/mcp/server.js`: all 14 tools callable; `create_card` visible in UI after refresh
- [ ] App + MCP running simultaneously: no `SQLITE_BUSY` errors
- [ ] `npm run package` → unpacked app boots with fresh migrated DB in `userData`
- [ ] `grep -r express src/ package.json` returns nothing (Step 4 cleanup)
