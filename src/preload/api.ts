import { ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';

/**
 * Re-throws IPC errors with a clean message: Electron wraps handler errors as
 * "Error invoking remote method '<channel>': Error: <original message>", and
 * the renderer only displays the message.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (e) {
    const raw = (e as Error).message;
    const msg = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    throw new Error(msg);
  }
}

export const planlyApi = {
  getBoards: () => invoke(IPC.boardsList),
  getBoard: (id: string) => invoke(IPC.boardsGet, id),
  getAllBoard: () => invoke(IPC.boardsAll),
  createColumn: (boardId: string, title: string) => invoke(IPC.columnsCreate, boardId, title),
  renameColumn: (id: string, title: string) => invoke(IPC.columnsRename, id, title),
  deleteColumn: (id: string) => invoke(IPC.columnsDelete, id),
  moveColumn: (id: string, beforeColumnId: string | null) => invoke(IPC.columnsMove, id, beforeColumnId),
  archiveAllCards: (colId: string) => invoke(IPC.columnsArchiveAll, colId),
  createCard: (colId: string, data: unknown) => invoke(IPC.cardsCreate, colId, data),
  updateCard: (id: string, data: unknown) => invoke(IPC.cardsUpdate, id, data),
  moveCard: (id: string, toColId: string, beforeCardId: string | null) =>
    invoke(IPC.cardsMove, id, toColId, beforeCardId),
  moveAllCard: (id: string, status: string, beforeCardId: string | null) =>
    invoke(IPC.cardsAllMove, id, status, beforeCardId),
  deleteCard: (id: string) => invoke(IPC.cardsDelete, id),
  archiveCard: (id: string, archived: boolean) => invoke(IPC.cardsArchive, id, archived),
  getArchivedCards: () => invoke(IPC.cardsArchivedList),
  restoreCard: (id: string) => invoke(IPC.cardsArchive, id, false),
};
