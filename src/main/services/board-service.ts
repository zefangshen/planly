import type { DatabaseSync } from 'node:sqlite';
import type { AllBoard, AllBoardCard, Board, BoardWithColumns, Column, CardStatus } from '../../shared/types/board';
import type { AllCardRow, BoardRow, CardRow, ColumnRow, StatusMaxRow } from './types';
import { mapCard } from './card-service';
import { ALL_BOARD_ID, ALL_COLUMN_PREFIX, CARD_STATUSES, statusFromColumnTitle } from '../../shared/constants';

/** List all boards. */
export function listBoards(db: DatabaseSync): { boards: Board[] } {
  const boards = db.prepare('SELECT id, title FROM boards ORDER BY position').all() as unknown as BoardRow[];
  return { boards: boards.map(b => ({ id: b.id, title: b.title })) };
}

/** Load a single board with columns and cards. Throws if board not found. */
export function getBoard(db: DatabaseSync, id: string): BoardWithColumns {
  const board = db
    .prepare('SELECT * FROM boards WHERE id = ?')
    .get(id) as unknown as BoardRow | undefined;
  if (!board) {
    throw new Error('Board not found');
  }

  const columns = db
    .prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position')
    .all(board.id) as unknown as ColumnRow[];
  const getCards = db.prepare(
    'SELECT * FROM cards WHERE column_id = ? AND archived = 0 ORDER BY position'
  );

  const boardColumns: Column[] = columns.map((col: ColumnRow) => {
    const cards = getCards.all(col.id) as unknown as CardRow[];
    return {
      id: col.id,
      title: col.title,
      cards: cards.map(mapCard),
    };
  });

  return { id: board.id, title: board.title, columns: boardColumns };
}

/**
 * Build the virtual "All" board: every non-archived card whose home column
 * title matches a canonical status (To Do / In Progress / Done) is bucketed
 * across all real boards. Cards keep their real columnId and carry board info.
 *
 * Card order is FREE within each bucket (not grouped by board) and persisted
 * in `all_card_order`. This call lazily:
 *  - inserts rows for cards that have none yet (initial backfill follows the
 *    board → column → card traversal order);
 *  - reconciles rows whose stored status no longer matches the card's home
 *    column (e.g. the card was moved on its real board) by appending it to the
 *    end of the now-correct bucket.
 */
export function getAllBoard(db: DatabaseSync): AllBoard {
  const rows = db.prepare(
    `SELECT c.id, c.title, c.description, c.due_date, c.labels, c.position,
            col.id AS column_id, col.title AS column_title,
            b.id AS board_id, b.title AS board_title,
            o.status AS order_status, o.position AS order_position
     FROM cards c
     JOIN columns col ON c.column_id = col.id
     JOIN boards b ON col.board_id = b.id
     LEFT JOIN all_card_order o ON o.card_id = c.id
     WHERE c.archived = 0
     ORDER BY b.position, col.position, c.position`
  ).all() as unknown as AllCardRow[];

  // Running max position per status, seeded from every persisted row
  const maxPos: Record<CardStatus, number> = { todo: -1, in_progress: -1, done: -1 };
  const maxRows = db
    .prepare('SELECT status, COALESCE(MAX(position), -1) AS m FROM all_card_order GROUP BY status')
    .all() as unknown as StatusMaxRow[];
  for (const r of maxRows) {
    if (r.status in maxPos) maxPos[r.status as CardStatus] = r.m;
  }

  const inserts: { id: string; status: CardStatus; position: number }[] = [];
  const updates: { id: string; status: CardStatus; position: number }[] = [];
  // Effective bucket + position for this load
  const placement = new Map<string, { status: CardStatus; position: number }>();

  for (const r of rows) {
    const derived = statusFromColumnTitle(r.column_title);
    if (!derived) continue;

    if (r.order_status === null || r.order_position === null) {
      const position = ++maxPos[derived];
      inserts.push({ id: r.id, status: derived, position });
      placement.set(r.id, { status: derived, position });
    } else if (r.order_status !== derived) {
      // Home column status changed outside the All board → append to the new bucket
      const position = ++maxPos[derived];
      updates.push({ id: r.id, status: derived, position });
      placement.set(r.id, { status: derived, position });
    } else {
      placement.set(r.id, { status: derived, position: r.order_position });
    }
  }

  if (inserts.length > 0 || updates.length > 0) {
    const insertStmt = db.prepare(
      'INSERT INTO all_card_order (card_id, status, position) VALUES (?, ?, ?)'
    );
    const updateStmt = db.prepare(
      'UPDATE all_card_order SET status = ?, position = ? WHERE card_id = ?'
    );
    db.exec('BEGIN');
    try {
      for (const i of inserts) insertStmt.run(i.id, i.status, i.position);
      for (const u of updates) updateStmt.run(u.status, u.position, u.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const buckets = new Map<CardStatus, AllBoardCard[]>(
    CARD_STATUSES.map(s => [s.key, []])
  );

  for (const r of rows) {
    const p = placement.get(r.id);
    if (!p) continue;
    buckets.get(p.status)!.push({
      id: r.id,
      columnId: r.column_id,
      title: r.title,
      description: r.description,
      dueDate: r.due_date,
      labels: JSON.parse(r.labels || '[]') as number[],
      boardId: r.board_id,
      boardTitle: r.board_title,
    });
  }

  for (const cards of buckets.values()) {
    cards.sort((a, b) => (placement.get(a.id)!.position) - (placement.get(b.id)!.position));
  }

  return {
    id: ALL_BOARD_ID,
    title: 'All',
    columns: CARD_STATUSES.map(s => ({
      id: `${ALL_COLUMN_PREFIX}${s.key}`,
      title: s.title,
      status: s.key,
      cards: buckets.get(s.key)!,
    })),
  };
}
