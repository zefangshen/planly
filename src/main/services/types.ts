// ---------------------------------------------------------------------------
// Database row types (main-process only)
// ---------------------------------------------------------------------------

export interface CardRow {
  id: string;
  column_id: string;
  title: string;
  description: string;
  due_date: string;
  labels: string;
  position: number;
  archived: number;
  archived_at: string | null;
}

export interface ColumnRow {
  id: string;
  board_id: string;
  title: string;
  position: number;
}

export interface BoardRow {
  id: string;
  title: string;
  position: number;
}

export interface PositionRow {
  m: number;
}

/** Joined row for the virtual All board aggregation. */
export interface AllCardRow {
  id: string;
  title: string;
  description: string;
  due_date: string;
  labels: string;
  position: number;
  column_id: string;
  column_title: string;
  board_id: string;
  board_title: string;
  order_status: string | null;
  order_position: number | null;
}

/** Row in the persisted All-board ordering table. */
export interface AllOrderRow {
  card_id: string;
  status: string;
  position: number;
}

export interface StatusMaxRow {
  status: string;
  m: number;
}

export interface ArchivedCardRow {
  id: string;
  title: string;
  description: string;
  due_date: string;
  labels: string;
  archived_at: string | null;
  column_title: string;
  board_id: string;
  board_title: string;
}
