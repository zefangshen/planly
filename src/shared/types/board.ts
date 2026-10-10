// ---------------------------------------------------------------------------
// Canonical API types — shared by main services, renderer, and MCP server
// ---------------------------------------------------------------------------

export interface Board {
  id: string;
  title: string;
}

export interface Card {
  id: string;
  columnId: string;
  title: string;
  description: string;
  dueDate: string;
  labels: number[];
}

export interface Column {
  id: string;
  title: string;
  cards: Card[];
}

export interface BoardWithColumns extends Board {
  columns: Column[];
}

// ---------------------------------------------------------------------------
// Virtual "All" board — computed aggregation across every real board
// ---------------------------------------------------------------------------

export type CardStatus = 'todo' | 'in_progress' | 'done';

export interface AllBoardCard extends Card {
  boardId: string;
  boardTitle: string;
}

export interface AllBoardColumn {
  /** Synthetic id, `all:<status>`. */
  id: string;
  title: string;
  status: CardStatus;
  cards: AllBoardCard[];
}

export interface AllBoard {
  id: string;
  title: string;
  columns: AllBoardColumn[];
}

export interface ArchivedCard {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  labels: number[];
  archivedAt: string;
  columnTitle: string;
  boardId: string;
  boardTitle: string;
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface CreateCardBody {
  title: string;
  description?: string;
  dueDate?: string;
  labels?: number[];
}

export type UpdateCardBody = CreateCardBody;
