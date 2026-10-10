/** IPC channel names — single source of truth for main handlers and preload bridge. */
export const IPC = {
  boardsList: 'boards:list',
  boardsGet: 'boards:get',
  boardsAll: 'boards:all',
  columnsCreate: 'columns:create',
  columnsRename: 'columns:rename',
  columnsDelete: 'columns:delete',
  columnsMove: 'columns:move',
  columnsArchiveAll: 'columns:archiveAll',
  cardsCreate: 'cards:create',
  cardsUpdate: 'cards:update',
  cardsMove: 'cards:move',
  cardsAllMove: 'cards:allMove',
  cardsDelete: 'cards:delete',
  cardsArchive: 'cards:archive',
  cardsArchivedList: 'cards:archived:list',
} as const;
