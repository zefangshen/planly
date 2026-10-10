# Plan: Restructure Planly to electron-vite Standard Layout

## Summary

Reorganize the project from the current split layout (root `tsc` main/preload + nested `client/` vite package) into a unified electron-vite structure with `src/{main,preload,renderer,shared}`, feature-based renderer folders, domain-split IPC handlers, and a services layer in main. The MCP stdio server stays a separate `tsc` build but imports from the new service locations.

Decisions (confirmed with user):
- **Adopt electron-vite** — one build tool for main/preload/renderer; merge `client/` into root `package.json`.
- **Adapt folders to Planly's domain** — `features/board/` + `features/archive/` instead of generic `projects/settings/dashboard`; omit empty dirs (`stores/`, `tests/`, `components/ui/`, `build/`, `resources/icons/`) until needed.

## Current State Analysis

```
planly/
├── package.json            # root: electron main + mcp (tsc → dist/)
├── tsconfig.json           # commonjs, rootDir src, outDir dist
├── migrations/             # 3 SQL files (extraResources in electron-builder)
├── public/                 # built renderer output (from client/)
├── client/                 # SEPARATE npm package (own package.json, vite → ../public)
│   └── src/{App,main,api,types,styles}.tsx/css, components/ (8), hooks/ (2)
├── src/
│   ├── main/index.ts       # lifecycle + window + window-state + paths (all-in-one)
│   ├── main/ipc.ts         # 13 handlers in one file
│   ├── preload.ts          # contextBridge
│   ├── core/               # db.ts, boards.ts, columns.ts, cards.ts, types.ts (pure node)
│   ├── mcp/server.ts       # stdio MCP server (imports core/*)
│   └── migrations/000_migrate_legacy_data.ts  # JS migration
└── planly.db               # dev DB
```

Key facts:
- `src/core/*` imports only node builtins — safe to share between Electron main and MCP server.
- `client/src/types.ts` duplicates `src/core/types.ts` API shapes (Board≈BoardSummary, BoardWithColumns≈BoardResponse, ArchivedCard≈ArchivedCardResponse); `LABEL_COLORS` is renderer-only.
- `node:sqlite` requires externalization (builtin) — electron-vite `externalizeDepsPlugin` handles it.
- Preload uses only `electron` imports → CJS output, sandbox-compatible.
- Dev flow today: `concurrently` tsc-watch + client vite + `wait-on` + `PLANLY_DEV=1 electron .` → replaced by single `electron-vite dev` (sets `ELECTRON_RENDERER_URL`).

## Target Structure

```
planly/
├── package.json                # single package; main: ./out/main/index.js
├── tsconfig.json               # node side (main/preload/shared), editor + noEmit
├── tsconfig.web.json           # renderer (jsx, DOM, bundler resolution)
├── tsconfig.mcp.json           # mcp + services + shared → dist-mcp/ (tsc, commonjs)
├── electron.vite.config.ts     # main/preload/renderer entries + react plugin + aliases
├── README.md                   # brief: structure + scripts (in requested tree)
├── resources/
│   └── migrations/             # moved from root migrations/ (SQL, extraResources)
├── src/
│   ├── main/
│   │   ├── index.ts            # app lifecycle + DB bootstrap only
│   │   ├── window.ts           # createWindow + window-state persistence
│   │   ├── ipc/
│   │   │   ├── index.ts        # registerIpc() aggregates domain registrars
│   │   │   ├── boards.ts       # boards:list, boards:get
│   │   │   ├── columns.ts      # columns:create/rename/delete/move/archiveAll
│   │   │   └── cards.ts        # cards:create/update/move/delete/archive/archived:list
│   │   ├── services/
│   │   │   ├── database-service.ts   # openDb, runMigrations, uid (from core/db.ts)
│   │   │   ├── board-service.ts      # from core/boards.ts
│   │   │   ├── column-service.ts     # from core/columns.ts
│   │   │   ├── card-service.ts       # from core/cards.ts
│   │   │   ├── types.ts              # DB row types (CardRow, ColumnRow, BoardRow, ...)
│   │   │   └── migrations/000_migrate_legacy_data.ts
│   │   └── utils/
│   │       └── paths.ts        # DATA_DIR, WINDOW_STATE_PATH, resolvePaths()
│   ├── preload/
│   │   ├── index.ts            # contextBridge.exposeInMainWorld
│   │   └── api.ts              # invoke() wrapper + planly bridge object
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/common/Header.tsx
│   │   ├── features/
│   │   │   ├── board/
│   │   │   │   ├── components/   # Board, Column, Card, CardModal, AddCardForm, AddColumnForm
│   │   │   │   └── hooks/useBoard.ts
│   │   │   └── archive/components/ArchivedView.tsx
│   │   ├── hooks/useTheme.ts
│   │   ├── lib/api.ts          # PlanlyApi interface + window.planly declaration
│   │   └── styles/global.css   # from client/src/styles.css
│   ├── shared/
│   │   ├── types/board.ts      # Board, Card, Column, BoardWithColumns, ArchivedCard, CreateCardBody, UpdateCardBody
│   │   ├── constants.ts        # LABEL_COLORS
│   │   └── ipc.ts              # IPC channel name constants
│   └── mcp/
│       └── server.ts           # unchanged logic; imports from main/services/*
└── planly.db                   # dev DB (unchanged)
```

Omitted until content exists (per "adapt to domain"): `tests/`, `stores/`, `components/ui/`, `build/`, `resources/icons/`, `shared/types/settings.ts`, `services/update-service.ts`.

## Proposed Changes

### 1. Tooling & config

**`electron.vite.config.ts`** (new):
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [react()],
  },
});
```
electron-vite defaults match the layout: main entry `src/main/index.ts` → `out/main/`, preload `src/preload/index.ts` → `out/preload/`, renderer root `src/renderer/` → `out/renderer/` with `base: './'`.

**`tsconfig.json`** (rewrite): node side only — `module: commonjs`, `target: ES2022`, `strict`, `noEmit: true`, include `src/main`, `src/preload`, `src/shared`, paths `@shared/*`.

**`tsconfig.web.json`** (new): `jsx: react-jsx`, `module: ESNext`, `moduleResolution: bundler`, `lib: [ES2022, DOM, DOM.Iterable]`, `noEmit: true`, include `src/renderer`, `src/shared`, paths `@shared/*`, `@renderer/*`.

**`tsconfig.mcp.json`** (new): `module: commonjs`, `rootDir: src`, `outDir: dist-mcp`, `declaration: false`, include `src/mcp`, `src/main/services`, `src/shared`. MCP stays on `tsc` because electron-vite doesn't build standalone node scripts; services are electron-free so this compiles cleanly. Output: `dist-mcp/mcp/server.js`.

**`package.json`**:
- `main`: `./out/main/index.js`
- Dependencies merged from `client/`: `react`, `react-dom`, `@hello-pangea/dnd`; keep `@modelcontextprotocol/sdk`, `zod`.
- DevDeps add: `electron-vite`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`; remove `concurrently`, `wait-on`.
- Scripts:
  - `dev`: `electron-vite dev`
  - `build`: `electron-vite build`
  - `start`: `electron-vite preview`
  - `build:mcp`: `tsc -p tsconfig.mcp.json`
  - `mcp`: `node dist-mcp/mcp/server.js`
  - `typecheck`: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.web.json`
  - `package`: `npm run build && electron-builder --dir`
  - `dist`: `npm run build && electron-builder`
- electron-builder: `files: ["out/**", "package.json"]` (drop `dist/**`, `public/**`); `extraResources: [{ from: "resources/migrations", to: "migrations" }]`.

### 2. `src/shared/`

- **`types/board.ts`**: merge `src/core/types.ts` API/transport types + `client/src/types.ts` into one canonical set: `Board`, `Card`, `Column`, `BoardWithColumns`, `ArchivedCard`, `CreateCardBody`, `UpdateCardBody`. Services return these shapes; renderer consumes them. (Dedupe: `BoardSummary`→`Board`, `BoardResponse`→`BoardWithColumns`, `ArchivedCardResponse`→`ArchivedCard` — identical shapes.)
- **`constants.ts`**: `LABEL_COLORS` (from client types.ts).
- **`ipc.ts`**: channel constants used by both `main/ipc/*` and `preload/api.ts`:
  ```ts
  export const IPC = {
    boardsList: 'boards:list', boardsGet: 'boards:get',
    columnsCreate: 'columns:create', columnsRename: 'columns:rename',
    columnsDelete: 'columns:delete', columnsMove: 'columns:move',
    columnsArchiveAll: 'columns:archiveAll',
    cardsCreate: 'cards:create', cardsUpdate: 'cards:update',
    cardsMove: 'cards:move', cardsDelete: 'cards:delete',
    cardsArchive: 'cards:archive', cardsArchivedList: 'cards:archived:list',
  } as const;
  ```

### 3. `src/main/`

- **`utils/paths.ts`**: extract from current `main/index.ts` — `DATA_DIR` (`appData/planly`), `WINDOW_STATE_PATH`, `resolvePaths()` returning `{ dbPath, sqlDir, legacyDb }`. Dev branch: `path.resolve(__dirname, '..', '..', '..')` → wait: compiled output is `out/main/utils/paths.js`, so project root is `path.resolve(__dirname, '..', '..', '..')` in dev (out/main/utils → root). Dev `sqlDir` → `<root>/resources/migrations`; dev dbPath stays `<root>/planly.db`. Packaged branch unchanged semantics (`process.resourcesPath/migrations`).
- **`window.ts`**: `createWindow(db)` + `loadWindowState`/`saveWindowState` moved as-is. Changes: preload path `path.join(__dirname, '../preload/index.js')`; dev load via `process.env.ELECTRON_RENDERER_URL` (electron-vite), prod `win.loadFile(path.join(__dirname, '../renderer/index.html'))`.
- **`index.ts`**: slim — app lifecycle, DB bootstrap (mkdir, legacy DB adoption, `openDb`, `runMigrations`), `createWindow(db)`, `activate`/`window-all-closed`.
- **`ipc/boards.ts|columns.ts|cards.ts`**: split current `main/ipc.ts` handlers by domain; each exports `register*(db)`; channel names from `shared/ipc.ts`.
- **`ipc/index.ts`**: `registerIpc(db)` calls the three domain registrars.
- **`services/`**: rename `core/*` → `*-service.ts` with import updates (`./types` for row types, `@shared/types/board` for API types). `database-service.ts` imports JS migration from `./migrations/000_migrate_legacy_data` (relative, stays asar-safe since it's bundled into `out/main`).

### 4. `src/preload/`

- **`api.ts`**: current `invoke()` wrapper + `planly` object; channels from `shared/ipc.ts`.
- **`index.ts`**: `contextBridge.exposeInMainWorld('planly', planlyApi)`.

### 5. `src/renderer/`

- Move `client/index.html` → `src/renderer/index.html` (script src `/src/main.tsx` → `./main.tsx`? — electron-vite renderer root is `src/renderer`, so keep `/main.tsx` style: `<script type="module" src="./main.tsx">` — vite resolves relative to root).
- `main.tsx`: import `./styles/global.css`.
- `lib/api.ts`: `PlanlyApi` interface + `window.planly` declaration + `export const api = window.planly`; types from `@shared/types/board`.
- `features/board/components/*`: Board, Column, Card, CardModal, AddCardForm, AddColumnForm — import updates only (`@renderer/lib/api`, `@shared/types/board`, `@shared/constants`).
- `features/board/hooks/useBoard.ts`: import updates.
- `features/archive/components/ArchivedView.tsx`: import updates.
- `components/common/Header.tsx`: app-wide nav → common.
- `hooks/useTheme.ts`: app-wide hook stays at top level.
- No logic changes to any component.

### 6. `src/mcp/server.ts`

- Import updates only: `../core/db` → `../main/services/database-service`, boards/columns/cards → respective `*-service`.
- `SQL_DIR` = `path.resolve(__dirname, '..', '..', 'resources', 'migrations')` (from `dist-mcp/mcp/` → root).
- Tool registrations, zod schemas, result wrapper unchanged.

### 7. Moves & deletions

- `migrations/*.sql` → `resources/migrations/`
- `src/migrations/000_migrate_legacy_data.ts` → `src/main/services/migrations/`
- Delete after moves verified: `client/` (incl. its `package.json`, `node_modules`, `package-lock.json`), `public/`, `dist/`, `src/core/`, `src/preload.ts`, root `package-lock.json` regenerated via fresh `npm install`.
- `README.md`: brief doc — structure overview, `npm run dev` / `build` / `package` / `build:mcp` usage (explicitly in the requested tree).

## Assumptions & Decisions

1. MCP server is **not** bundled by electron-vite — separate `tsc` build to `dist-mcp/`; it's launched by external agents via `npm run mcp` / absolute node path, never packaged into the app.
2. Main/preload output stays **CJS** (no `"type": "module"` at root) — required for sandboxed preload; Electron 37 compatible.
3. Empty template dirs are skipped (user chose domain adaptation); can be added when content exists.
4. `stores/` omitted — app uses hooks + local state, no state library; introducing one is out of scope.
5. Dev DB stays at project-root `planly.db`; packaged DB at `~/Library/Application Support/planly/planly.db` — both untouched by the restructure (data continuity).
6. `window-state.json` path unchanged.
7. Aliases `@shared` / `@renderer` configured in both electron-vite and tsconfigs to keep imports stable.

## Verification

1. `npm install` (root only, after client merge) — succeeds, no `client/` remnants.
2. `npm run typecheck` — both tsconfigs clean.
3. `npm run dev` — app launches via electron-vite; board loads, create/rename/delete/move column, card CRUD, drag-and-drop, archive/restore, archived view, theme toggle all work; window state persists across restart; last-open tab restored.
4. `npm run build:mcp && npm run mcp` — MCP server starts, lists 14 tools against dev DB (`PLANLY_DB` override or default path).
5. `npm run package` — `release/mac-arm64/Planly.app` launches against the packaged DB (`~/Library/Application Support/planly/planly.db`) with existing data intact; migrations applied from `process.resourcesPath/migrations`.
