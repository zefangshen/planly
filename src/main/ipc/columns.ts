import { ipcMain } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import {
  createColumn,
  renameColumn,
  deleteColumn,
  moveColumn,
  archiveAllCards,
} from '../services/column-service';
import { IPC } from '../../shared/ipc';

export function registerColumnsIpc(db: DatabaseSync): void {
  ipcMain.handle(IPC.columnsCreate, (_e, boardId: string, title: string) =>
    createColumn(db, boardId, title)
  );
  ipcMain.handle(IPC.columnsRename, (_e, id: string, title: string) =>
    renameColumn(db, id, title)
  );
  ipcMain.handle(IPC.columnsDelete, (_e, id: string) => deleteColumn(db, id));
  ipcMain.handle(IPC.columnsMove, (_e, id: string, beforeColumnId: string | null) =>
    moveColumn(db, id, beforeColumnId)
  );
  ipcMain.handle(IPC.columnsArchiveAll, (_e, colId: string) => archiveAllCards(db, colId));
}
