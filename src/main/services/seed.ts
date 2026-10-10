import type { DatabaseSync } from 'node:sqlite';

/**
 * Seed default boards (Career, Work, Life) with columns and sample cards.
 *
 * This is application seed data, not a schema migration — it runs once after
 * migrations, only when the database has no boards yet. All inserts are
 * guarded by EXISTS checks so the seed is safe to re-run.
 */
export function seed(db: DatabaseSync): void {
  const boardCount = db.prepare('SELECT COUNT(*) AS c FROM boards').get() as { c: number };
  if (boardCount.c > 0) return;

  db.exec('BEGIN');
  try {
    // Boards
    db.prepare(
      "INSERT INTO boards (id, title, position) SELECT 'board_career', 'Career', 0 WHERE NOT EXISTS (SELECT 1 FROM boards)"
    ).run();
    db.prepare(
      "INSERT INTO boards (id, title, position) SELECT 'board_work', 'Work', 1 WHERE NOT EXISTS (SELECT 1 FROM boards WHERE title = 'Work')"
    ).run();
    db.prepare(
      "INSERT INTO boards (id, title, position) SELECT 'board_life', 'Life', 2 WHERE NOT EXISTS (SELECT 1 FROM boards WHERE title = 'Life')"
    ).run();

    // Career board columns
    seedColumn(db, 'col_career_todo', 'board_career', 'To Do', 0);
    seedColumn(db, 'col_career_progress', 'board_career', 'In Progress', 1);
    seedColumn(db, 'col_career_done', 'board_career', 'Done', 2);

    // Work board columns
    seedColumn(db, 'col_work_todo', 'board_work', 'To Do', 0);
    seedColumn(db, 'col_work_progress', 'board_work', 'In Progress', 1);
    seedColumn(db, 'col_work_done', 'board_work', 'Done', 2);

    // Life board columns
    seedColumn(db, 'col_life_todo', 'board_life', 'To Do', 0);
    seedColumn(db, 'col_life_progress', 'board_life', 'In Progress', 1);
    seedColumn(db, 'col_life_done', 'board_life', 'Done', 2);

    // Sample cards
    seedCard(db, 'card_career_1', 'col_career_todo', 'Update resume', 'Drag cards across columns. Click a card to edit.', '[1]');
    seedCard(db, 'card_career_2', 'col_career_progress', 'Try dragging this card', '', '[5]');
    seedCard(db, 'card_career_3', 'col_career_done', 'Set up the board', '', '[0]');

    seedCard(db, 'card_work_1', 'col_work_todo', 'Review project plan', 'Drag cards across columns. Click a card to edit.', '[1]');
    seedCard(db, 'card_work_2', 'col_work_progress', 'Try dragging this card', '', '[5]');
    seedCard(db, 'card_work_3', 'col_work_done', 'Set up the board', '', '[0]');

    seedCard(db, 'card_life_1', 'col_life_todo', 'Grocery shopping', 'Drag cards across columns. Click a card to edit.', '[1]');
    seedCard(db, 'card_life_2', 'col_life_progress', 'Try dragging this card', '', '[5]');
    seedCard(db, 'card_life_3', 'col_life_done', 'Set up the board', '', '[0]');

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function seedColumn(db: DatabaseSync, id: string, boardId: string, title: string, position: number): void {
  db.prepare(
    `INSERT INTO columns (id, board_id, title, position)
     SELECT ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM boards WHERE id = ?)
       AND NOT EXISTS (SELECT 1 FROM columns WHERE board_id = ? AND title = ?)`
  ).run(id, boardId, title, position, boardId, boardId, title);
}

function seedCard(db: DatabaseSync, id: string, colId: string, title: string, description: string, labels: string): void {
  db.prepare(
    `INSERT INTO cards (id, column_id, title, description, due_date, labels, position)
     SELECT ?, ?, ?, ?, '', ?, 0
     WHERE EXISTS (SELECT 1 FROM columns WHERE id = ?)
       AND NOT EXISTS (SELECT 1 FROM cards WHERE id = ?)`
  ).run(id, colId, title, description, labels, colId, id);
}
