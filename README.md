# Planly

A Trello-style Kanban board — Electron + `node:sqlite` + React, with an MCP stdio server so agents can operate the same database.

## Structure

```
src/
├── main/                  # Electron main process
│   ├── index.ts           # App lifecycle + DB bootstrap
│   ├── window.ts          # Window creation + window-state persistence
│   ├── ipc/               # IPC handlers split by domain (boards/columns/cards)
│   ├── services/          # Pure-node data layer (shared with the MCP server)
│   │   ├── database-service.ts   # openDb, migration runner, uid
│   │   ├── board-service.ts / column-service.ts / card-service.ts
│   │   └── migrations/    # Built-in JS migrations
│   └── utils/paths.ts     # DB / migrations / window-state path resolution
├── preload/
│   ├── index.ts           # contextBridge expose
│   └── api.ts             # invoke wrapper + window.planly bridge
├── renderer/              # React app (vite)
│   ├── components/common/ # App-wide components (Header)
│   ├── features/board/    # Kanban board: components + useBoard hook
│   ├── features/archive/  # Archived-cards view
│   ├── hooks/             # App-wide hooks (useTheme)
│   ├── lib/api.ts         # PlanlyApi interface + window.planly typing
│   └── styles/global.css
├── shared/                # Code shared by main / preload / renderer / mcp
│   ├── types/board.ts     # Canonical API types
│   ├── constants.ts       # LABEL_COLORS
│   └── ipc.ts             # IPC channel names
└── mcp/server.ts          # MCP stdio server (separate tsc build)

resources/migrations/      # SQL migrations (packaged via extraResources)
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start electron-vite dev (main + preload + renderer HMR, launches Electron) |
| `npm run build` | Production build of all three bundles → `out/` |
| `npm start` | Preview the production build |
| `npm run build:mcp` | Build the MCP server → `dist-mcp/` (tsc) |
| `npm run mcp` | Run the MCP stdio server |
| `npm run typecheck` | Typecheck node side + renderer |
| `npm run package` | Build + package unpacked app → `release/` |
| `npm run dist` | Build + create distributables (dmg) |

## Data locations

- Dev database: `./planly.db` (project root)
- Packaged database: `~/Library/Application Support/planly/planly.db`
- MCP server DB: `PLANLY_DB` env var, or the packaged location above (shared with the app via WAL mode)
