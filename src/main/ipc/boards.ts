import { ipcMain } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { listBoards, getBoard, getAllBoard } from '../services/board-service';
import { IPC } from '../../shared/ipc';

export function registerBoardsIpc(db: DatabaseSync): void {
  ipcMain.handle(IPC.boardsList, () => listBoards(db));
  ipcMain.handle(IPC.boardsGet, (_e, id: string) => getBoard(db, id));
  ipcMain.handle(IPC.boardsAll, () => getAllBoard(db));
}
