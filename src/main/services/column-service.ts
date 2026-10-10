import type { DatabaseSync } from 'node:sqlite';
import { uid } from './database-service';
import { ALL_COLUMN_PREFIX, CARD_STATUSES, statusFromColumnTitle } from '../../shared/constants';
import type { CardStatus, Column } from '../../shared/types/board';
import type { ColumnRow, PositionRow } from './types';

/** Create a new column on a board. Throws if title is empty. */
export function createColumn(db: DatabaseSync, boardId: string, title: string): Column {
  if (!title || !title.trim()) {
    throw new Error('Title required');
  }
  const { m: maxPos } = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM columns WHERE board_id = ?')
    .get(boardId) as unknown as PositionRow;
  const id = uid();
  db.prepare(
    'INSERT INTO columns (id, board_id, title, position) VALUES (?, ?, ?, ?)'
  ).run(id, boardId, title.trim(), maxPos + 1);
  return { id, title: title.trim(), cards: [] };
}

/** Rename a column. Throws if title is empty. */
export function renameColumn(db: DatabaseSync, id: string, title: string): { ok: boolean } {
  if (!title || !title.trim()) {
    throw new Error('Title required');
  }
  db.prepare('UPDATE columns SET title = ? WHERE id = ?').run(title.trim(), id);
  return { ok: true };
}

/** Delete a column and all its cards. */
export function deleteColumn(db: DatabaseSync, id: string): { ok: boolean } {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM cards WHERE column_id = ?').run(id);
    db.prepare('DELETE FROM columns WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

/** Reorder a column within its board. Throws if column not found. */
export function moveColumn(
  db: DatabaseSync,
  colId: string,
  beforeColumnId: string | null
): { ok: boolean } {
  const col = db
    .prepare('SELECT * FROM columns WHERE id = ?')
    .get(colId) as unknown as ColumnRow | undefined;
  if (!col) {
    throw new Error('Column not found');
  }

  const targetCols = db
    .prepare('SELECT * FROM columns WHERE board_id = ? AND id != ? ORDER BY position')
    .all(col.board_id, colId) as unknown as ColumnRow[];

  let insertIdx: number;
  if (beforeColumnId) {
    insertIdx = targetCols.findIndex((c: ColumnRow) => c.id === beforeColumnId);
    if (insertIdx === -1) insertIdx = targetCols.length;
  } else {
    insertIdx = targetCols.length;
  }

  const newOrder: ColumnRow[] = [...targetCols];
  newOrder.splice(insertIdx, 0, col);

  const updatePos = db.prepare(
    'UPDATE columns SET position = ? WHERE id = ?'
  );

  db.exec('BEGIN');
  try {
    newOrder.forEach((c: ColumnRow, i: number) => {
      updatePos.run(i, c.id);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

/**
 * Archive all cards in a column. Accepts real column ids as well as virtual
 * All board columns (`all:<status>`), which archive every non-archived card
 * whose home column title maps to that canonical status across all boards.
 */
export function archiveAllCards(db: DatabaseSync, colId: string): { ok: boolean; archivedCount: number } {
  let result;
  if (colId.startsWith(ALL_COLUMN_PREFIX)) {
    const status = colId.slice(ALL_COLUMN_PREFIX.length) as CardStatus;
    if (!CARD_STATUSES.some(s => s.key === status)) {
      throw new Error('Unknown status');
    }
    const cols = db.prepare('SELECT id, title FROM columns').all() as unknown as { id: string; title: string }[];
    const colIds = cols
      .filter(c => statusFromColumnTitle(c.title) === status)
      .map(c => c.id);
    if (colIds.length === 0) {
      return { ok: true, archivedCount: 0 };
    }
    const placeholders = colIds.map(() => '?').join(', ');
    result = db.prepare(
      `UPDATE cards SET archived = 1, archived_at = datetime('now') WHERE column_id IN (${placeholders}) AND archived = 0`
    ).run(...colIds);
  } else {
    result = db.prepare(
      'UPDATE cards SET archived = 1, archived_at = datetime(\'now\') WHERE column_id = ? AND archived = 0'
    ).run(colId);
  }
  return { ok: true, archivedCount: Number(result.changes) };
}
