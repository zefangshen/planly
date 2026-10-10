import type { DatabaseSync } from 'node:sqlite';
import { uid } from './database-service';

/**
 * One-time repair for databases created before the multi-board feature.
 *
 * Legacy single-board databases had a `columns` table with rows but an empty
 * `boards` table (the board concept was introduced later). This attaches
 * those orphaned columns to a freshly created "Career" board.
 *
 * On fresh databases (no tables) or already-multi-board databases, this is
 * a no-op. Runs before Drizzle migrations so the schema baseline applies
 * cleanly afterwards.
 */
export function bootstrapLegacy(db: DatabaseSync): void {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('boards', 'columns')")
    .all() as { name: string }[];

  if (tables.length === 0) return;

  const boardCount = db.prepare('SELECT COUNT(*) AS c FROM boards').get() as { c: number };
  if (boardCount.c > 0) return;

  const colCount = db.prepare('SELECT COUNT(*) AS c FROM columns').get() as { c: number };
  if (colCount.c === 0) return;

  const boardId = uid();
  db.prepare('INSERT INTO boards (id, title, position) VALUES (?, ?, ?)').run(boardId, 'Career', 0);
  db.prepare('UPDATE columns SET board_id = ? WHERE board_id IS NULL').run(boardId);
}
