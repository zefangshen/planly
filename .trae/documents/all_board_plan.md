# "All" Board Implementation Plan

## Repository Research

Planly is an Electron + React kanban app (`electron-vite` layout) with an MCP server sharing the same service layer.

Current architecture:

- **Data model** ([schema.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/db/schema.ts)): `boards` → `columns` → `cards`; cards have `archived`, `position`, labels. Seed creates 3 boards (Career, Work, Life), each with columns **To Do / In Progress / Done** ([seed.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/services/seed.ts)).
- **Services** (raw SQL via `node:sqlite`): [board-service.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/services/board-service.ts) has `listBoards()` and `getBoard(id)` (columns ordered by position, non-archived cards ordered by position). [card-service.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/services/card-service.ts) has `moveCard(cardId, toColId, beforeCardId)` which moves within/between **real** columns and reindexes positions transactionally.
- **IPC/preload/renderer API**: channel names in [ipc.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/shared/ipc.ts), handlers in `src/main/ipc/*`, bridge in [preload/api.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/preload/api.ts), typed interface in [renderer/lib/api.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/lib/api.ts).
- **Renderer**: [useBoard.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/features/board/hooks/useBoard.ts) loads boards, restores last-open board from `localStorage` (`planly_active_board`), defaults to first board. [App.tsx](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/App.tsx) owns all card/column optimistic mutations and renders `Header` (board tabs), `Board` (drag-and-drop via `@hello-pangea/dnd`), `CardModal`, `ArchivedView`.
- `Board` → `Column` supports column drag/reorder, rename (double-click), delete, archive-all, add-card form; `Card` supports drag, click-to-edit, right-click archive.

### Design decision: virtual, not persisted

The All board is a **read-only aggregate computed on demand** — no `boards` row, no schema change, no migration:

- It appears as the first tab ("All"), selected by default when no saved tab exists; last-open tab restoration still wins.
- It always shows exactly 3 buckets — **To Do / In Progress / Done** — aggregating cards from every real board whose column title matches (normalized: trimmed, lowercased, whitespace-collapsed). Cards with other/custom column titles are excluded from All.
- Cards keep their real `columnId`; the payload additionally carries `boardId`/`boardTitle` so a board badge can be rendered.
- Allowed card actions in All: click to edit (existing `CardModal`), archive, and **drag between the 3 status buckets** — resolved server-side onto the matching column of the card's own board (appended to end; view refreshes for authoritative order). Same-bucket reordering is disabled (positions belong to different boards).
- Disabled in All: add/edit/delete/reorder columns, add card (no target board), archive-all column.

## Files and Modules

### Shared
- `src/shared/constants.ts`: add `ALL_BOARD_ID = 'all'`, synthetic column-id prefix (`all:`), and canonical status definitions `[{ key: 'todo', title: 'To Do' }, { key: 'in_progress', title: 'In Progress' }, { key: 'done', title: 'Done' }]` with a `normalizeColumnTitle()` helper.
- `src/shared/types/board.ts`: add `CardStatus` union; `AllBoardCard extends Card { boardId: string; boardTitle: string }`; `AllBoardColumn { id; title; status: CardStatus; cards: AllBoardCard[] }`; `AllBoard { id: typeof ALL_BOARD_ID; title: 'All'; columns: AllBoardColumn[] }`.
- `src/shared/ipc.ts`: add `boardsAll: 'boards:all'` and `cardsMoveToStatus: 'cards:moveToStatus'`.

### Main (services + IPC)
- `src/main/services/board-service.ts`: add `getAllBoard(db): AllBoard` — one joined query (`cards JOIN columns JOIN boards`, `archived = 0`), normalize column titles, bucket into the 3 fixed statuses, order by board `position`, column `position`, card `position`; synthetic column ids `all:<status>`.
- `src/main/services/card-service.ts`: add `moveCardToStatus(db, cardId, status)` — look up card → its column → its board; find target column on the **same board** by normalized title; throw a clear error if missing; append card to end and reindex target column in a transaction (reuse the existing positional update pattern).
- `src/main/ipc/boards.ts`: handle `boards:all`; `src/main/ipc/cards.ts`: handle `cards:moveToStatus`.

### Preload + renderer API
- `src/preload/api.ts`: add `getAllBoard()` and `moveCardToStatus(id, status)`.
- `src/renderer/lib/api.ts`: add the two methods to `PlanlyApi`.

### Renderer UI
- `src/renderer/features/board/hooks/useBoard.ts`: route `loadBoard(ALL_BOARD_ID)` to `api.getAllBoard()`; accept saved `'all'` tab; default to All when no saved selection.
- `src/renderer/App.tsx`: compose header tabs as `[All, ...realBoards]` (ArchivedView filter keeps real boards only); pass an `allMode` flag to `Board`; in `onMoveCard`, detect `all:` destination columns and call `moveCardToStatus` (optimistic move between buckets, then `refresh()` to reconcile); card edit/delete/archive handlers stay as-is.
- `src/renderer/features/board/components/Board.tsx`: add optional `allMode` prop — hide the add-column wrapper; disable column dragging (`isDragDisabled`); ignore same-bucket card reorders; pass read-only flag to `Column`.
- `src/renderer/features/board/components/Column.tsx`: add read-only mode — non-editable title, hidden `⋯` menu and "Add a card" button, disabled `Draggable`.
- `src/renderer/features/board/components/Card.tsx`: render optional board badge from `card.boardTitle` (extend props/card usage; `AllBoardCard` is structurally a `Card`).
- `src/renderer/styles/global.css`: add `.card-board-badge` styles (small subtle chip, light/dark variables).

### MCP (parity with existing service sharing)
- `src/mcp/server.ts`: register `get_all_board` tool wrapping `getAllBoard(db)`. `list_boards` stays real-boards-only.

## Implementation Steps

1. Add shared constants (`ALL_BOARD_ID`, statuses, title normalizer) and types + IPC channel names.
2. Implement `getAllBoard()` in board-service; register `boards:all` IPC; expose through preload + renderer API interface.
3. Implement `moveCardToStatus()` in card-service; register `cards:moveToStatus` IPC; expose through preload + interface.
4. Update `useBoard` to route/load/restore/default the virtual All board.
5. Update `App.tsx`: tabs composition, `allMode` propagation, All-aware move handler.
6. Update `Board.tsx` / `Column.tsx` read-only behavior; add card board badge + CSS.
7. Add the `get_all_board` MCP tool; rebuild MCP (`npm run build:mcp`).
8. Run `npm run typecheck` and `npm run build`; manually verify in `npm run dev`.

## Dependencies and Considerations

- No database/schema/Drizzle migration changes — purely a derived view.
- Bucket matching is by **normalized column title**. Renamed or custom columns (e.g. "Waiting") do not appear in All; this matches the requested scope (To Do / In Progress / Done).
- Cross-bucket drag appends to the end of the home board's real target column; cross-board interleaving/position preservation is intentionally out of scope. The post-move refresh guarantees UI/DB consistency.
- Adding cards from All is omitted (ambiguous target board); a future board picker can enable it.
- All payload remains structurally assignable to `BoardWithColumns`/`Card`, so `Board`, `Card`, and `CardModal` need minimal prop changes.

## Validation

- `npm run typecheck` (node + web tsconfigs) and `npm run build` pass.
- `npm run build:mcp` passes; `get_all_board` returns 3 buckets with cards ordered Career → Work → Life.
- Manual (dev app):
  - All tab is first and default; refresh restores the last-open tab including All.
  - Each bucket contains the seeded cards from all 3 boards; every card shows its board badge; counts match each board's column.
  - Columns can't be renamed/deleted/reordered/added; no add-card UI in All.
  - Dragging a card To Do → Done moves it to its home board's Done column (verified on the real board); same-bucket drag snaps back.
  - Click-to-edit save, right-click Archive, and Archived view all still work and remove/update the card in All.

## Risks

- **Target status column missing on the home board** (user deleted/renamed it): service throws a descriptive error; renderer shows the error status and refreshes, reverting the optimistic move.
- **Stale aggregate after mutations**: mitigated by `refresh()` after status moves and reusing the existing refresh paths for edit/archive/delete.
- **DnD same-bucket reorder expectation**: explicitly disabled in All mode; the UI snaps back, matching the server model (per-board positions).
