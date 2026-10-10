import { ipcMain } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import {
  createCard,
  updateCard,
  moveCard,
  moveAllCard,
  deleteCard,
  setCardArchived,
  listArchivedCards,
} from '../services/card-service';
import type { CardStatus, CreateCardBody } from '../../shared/types/board';
import { IPC } from '../../shared/ipc';

export function registerCardsIpc(db: DatabaseSync): void {
  ipcMain.handle(IPC.cardsCreate, (_e, colId: string, data: CreateCardBody) =>
    createCard(db, colId, data)
  );
  ipcMain.handle(IPC.cardsUpdate, (_e, id: string, data: CreateCardBody) =>
    updateCard(db, id, data)
  );
  ipcMain.handle(IPC.cardsMove, (_e, id: string, toColId: string, beforeCardId: string | null) =>
    moveCard(db, id, toColId, beforeCardId)
  );
  ipcMain.handle(
    IPC.cardsAllMove,
    (_e, id: string, status: CardStatus, beforeCardId: string | null) =>
      moveAllCard(db, id, status, beforeCardId)
  );
  ipcMain.handle(IPC.cardsDelete, (_e, id: string) => deleteCard(db, id));
  ipcMain.handle(IPC.cardsArchive, (_e, id: string, archived: boolean) =>
    setCardArchived(db, id, archived)
  );
  ipcMain.handle(IPC.cardsArchivedList, () => listArchivedCards(db));
}
