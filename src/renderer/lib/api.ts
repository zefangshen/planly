import type { AllBoard, Board, BoardWithColumns, Column, Card, CardStatus, ArchivedCard } from '@shared/types/board';

export interface PlanlyApi {
  getBoards(): Promise<{ boards: Board[] }>;
  getBoard(id: string): Promise<BoardWithColumns>;
  getAllBoard(): Promise<AllBoard>;
  createColumn(boardId: string, title: string): Promise<Column>;
  renameColumn(id: string, title: string): Promise<{ ok: boolean }>;
  deleteColumn(id: string): Promise<{ ok: boolean }>;
  moveColumn(id: string, beforeColumnId: string | null): Promise<{ ok: boolean }>;
  archiveAllCards(colId: string): Promise<{ ok: boolean; archivedCount: number }>;
  createCard(
    colId: string,
    data: { title: string; description?: string; dueDate?: string; labels?: number[] }
  ): Promise<Card>;
  updateCard(id: string, data: Partial<Card>): Promise<{ ok: boolean }>;
  moveCard(id: string, toColId: string, beforeCardId: string | null): Promise<{ ok: boolean }>;
  moveAllCard(id: string, status: CardStatus, beforeCardId: string | null): Promise<{ ok: boolean }>;
  deleteCard(id: string): Promise<{ ok: boolean }>;
  archiveCard(id: string, archived: boolean): Promise<{ ok: boolean }>;
  getArchivedCards(): Promise<{ cards: ArchivedCard[] }>;
  restoreCard(id: string): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    planly: PlanlyApi;
  }
}

/** Data access goes through the Electron preload bridge (window.planly). */
export const api: PlanlyApi = window.planly;
