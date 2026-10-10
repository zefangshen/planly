import type { DatabaseSync } from 'node:sqlite';
import { uid } from './database-service';
import type { ArchivedCard, Card, CardStatus, CreateCardBody } from '../../shared/types/board';
import type { AllOrderRow, ArchivedCardRow, CardRow, PositionRow } from './types';
import { CARD_STATUSES, normalizeColumnTitle, statusFromColumnTitle } from '../../shared/constants';

export function mapCard(c: CardRow): Card {
  return {
    id: c.id,
    columnId: c.column_id,
    title: c.title,
    description: c.description,
    dueDate: c.due_date,
    labels: JSON.parse(c.labels || '[]') as number[],
  };
}

/** Create a card in a column. Throws if title is empty. */
export function createCard(db: DatabaseSync, colId: string, data: CreateCardBody): Card {
  const { title, description, dueDate, labels } = data;
  if (!title || !title.trim()) {
    throw new Error('Title required');
  }
  const { m: maxPos } = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM cards WHERE column_id = ?')
    .get(colId) as unknown as PositionRow;
  const id = uid();
  db.prepare(
    'INSERT INTO cards (id, column_id, title, description, due_date, labels, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    colId,
    title.trim(),
    (description || '').trim(),
    dueDate || '',
    JSON.stringify(labels || []),
    maxPos + 1
  );
  return {
    id,
    columnId: colId,
    title: title.trim(),
    description: (description || '').trim(),
    dueDate: dueDate || '',
    labels: labels || [],
  };
}

/** Update a card. Throws if title is empty. */
export function updateCard(db: DatabaseSync, id: string, data: CreateCardBody): { ok: boolean } {
  const { title, description, dueDate, labels } = data;
  if (!title || !title.trim()) {
    throw new Error('Title required');
  }
  db.prepare(
    'UPDATE cards SET title = ?, description = ?, due_date = ?, labels = ? WHERE id = ?'
  ).run(
    title.trim(),
    (description || '').trim(),
    dueDate || '',
    JSON.stringify(labels || []),
    id
  );
  return { ok: true };
}

/** Move a card to another column/position. Throws if card not found. */
export function moveCard(
  db: DatabaseSync,
  cardId: string,
  toColId: string,
  beforeCardId: string | null
): { ok: boolean } {
  const card = db
    .prepare('SELECT * FROM cards WHERE id = ?')
    .get(cardId) as unknown as CardRow | undefined;
  if (!card) {
    throw new Error('Card not found');
  }

  const targetCards = db
    .prepare('SELECT * FROM cards WHERE column_id = ? AND id != ? ORDER BY position')
    .all(toColId, cardId) as unknown as CardRow[];

  let insertIdx: number;
  if (beforeCardId) {
    insertIdx = targetCards.findIndex((c: CardRow) => c.id === beforeCardId);
    if (insertIdx === -1) insertIdx = targetCards.length;
  } else {
    insertIdx = targetCards.length;
  }

  const newOrder: CardRow[] = [...targetCards];
  newOrder.splice(insertIdx, 0, card);

  const updatePos = db.prepare(
    'UPDATE cards SET column_id = ?, position = ? WHERE id = ?'
  );

  db.exec('BEGIN');
  try {
    newOrder.forEach((c: CardRow, i: number) => {
      updatePos.run(toColId, i, c.id);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

export function deleteCard(db: DatabaseSync, id: string): { ok: boolean } {
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Move a card to the canonical-status column (To Do / In Progress / Done) on
 * its OWN board — used by the virtual All board. The card is appended to the
 * end of the target column, which is matched by normalized title. Throws if
 * the card or the target status column doesn't exist on the card's board.
 */
export function moveCardToStatus(
  db: DatabaseSync,
  cardId: string,
  status: CardStatus
): { ok: boolean } {
  const card = db
    .prepare('SELECT * FROM cards WHERE id = ?')
    .get(cardId) as unknown as CardRow | undefined;
  if (!card) {
    throw new Error('Card not found');
  }

  const statusDef = CARD_STATUSES.find(s => s.key === status);
  if (!statusDef) {
    throw new Error('Unknown status');
  }

  const home = db
    .prepare(
      `SELECT col.board_id AS board_id, b.title AS board_title
       FROM columns col JOIN boards b ON col.board_id = b.id
       WHERE col.id = ?`
    )
    .get(card.column_id) as unknown as { board_id: string; board_title: string } | undefined;
  if (!home) {
    throw new Error('Source column not found');
  }

  const boardCols = db
    .prepare('SELECT id, title FROM columns WHERE board_id = ?')
    .all(home.board_id) as unknown as { id: string; title: string }[];
  const targetCol = boardCols.find(c => statusFromColumnTitle(c.title) === status);
  if (!targetCol) {
    throw new Error(
      `"${statusDef.title}" column not found on board "${home.board_title}" (matched columns: ${boardCols.map(c => normalizeColumnTitle(c.title)).join(', ') || 'none'})`
    );
  }

  const targetCards = db
    .prepare('SELECT * FROM cards WHERE column_id = ? ORDER BY position')
    .all(targetCol.id) as unknown as CardRow[];
  const newOrder: CardRow[] = [...targetCards.filter(c => c.id !== cardId), card];

  const updatePos = db.prepare('UPDATE cards SET column_id = ?, position = ? WHERE id = ?');

  db.exec('BEGIN');
  try {
    newOrder.forEach((c: CardRow, i: number) => {
      updatePos.run(targetCol.id, i, c.id);
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

/**
 * Move/reorder a card inside the virtual All board.
 *
 * - Cross-bucket (e.g. To Do → Done): the card is also moved onto the
 *   matching status column of its home board via moveCardToStatus.
 * - Same-bucket: only the All-board position changes.
 *
 * Ordering is global per bucket (cards from different boards interleave freely)
 * and persisted in `all_card_order`. The card is placed before beforeCardId,
 * or at the end when beforeCardId is null.
 */
export function moveAllCard(
  db: DatabaseSync,
  cardId: string,
  toStatus: CardStatus,
  beforeCardId: string | null
): { ok: boolean } {
  const card = db
    .prepare('SELECT * FROM cards WHERE id = ?')
    .get(cardId) as unknown as CardRow | undefined;
  if (!card) {
    throw new Error('Card not found');
  }
  if (!CARD_STATUSES.some(s => s.key === toStatus)) {
    throw new Error('Unknown status');
  }

  const home = db
    .prepare(
      `SELECT col.title AS column_title
       FROM columns col WHERE col.id = ?`
    )
    .get(card.column_id) as unknown as { column_title: string } | undefined;
  const currentStatus = home ? statusFromColumnTitle(home.column_title) : null;
  if (!currentStatus) {
    throw new Error('Card is not in a To Do / In Progress / Done column');
  }

  // Sync the home board first — it throws (before any order writes) if the
  // target status column doesn't exist on the card's board.
  if (toStatus !== currentStatus) {
    moveCardToStatus(db, cardId, toStatus);
  }

  const orderRows = db
    .prepare(
      `SELECT card_id, status, position FROM all_card_order
       WHERE status IN (?, ?) ORDER BY position`
    )
    .all(currentStatus, toStatus) as unknown as AllOrderRow[];

  const sourceIds = orderRows.filter(r => r.status === currentStatus).map(r => r.card_id);
  const destIds = toStatus === currentStatus
    ? sourceIds
    : orderRows.filter(r => r.status === toStatus).map(r => r.card_id);

  // getAllBoard normally backfills the row; defensively make sure the card is present
  if (!sourceIds.includes(cardId)) sourceIds.push(cardId);

  const reordered = destIds.filter(id => id !== cardId);
  let insertIdx = reordered.length;
  if (beforeCardId) {
    const idx = reordered.findIndex(id => id === beforeCardId);
    if (idx !== -1) insertIdx = idx;
  }
  reordered.splice(insertIdx, 0, cardId);

  const upsert = db.prepare(
    `INSERT INTO all_card_order (card_id, status, position) VALUES (?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET status = excluded.status, position = excluded.position`
  );
  const updatePos = db.prepare('UPDATE all_card_order SET position = ? WHERE card_id = ?');

  db.exec('BEGIN');
  try {
    reordered.forEach((id, i) => upsert.run(id, toStatus, i));
    if (toStatus !== currentStatus) {
      sourceIds.filter(id => id !== cardId).forEach((id, i) => updatePos.run(i, id));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { ok: true };
}

export function setCardArchived(db: DatabaseSync, id: string, archived: boolean): { ok: boolean } {
  if (archived) {
    db.prepare('UPDATE cards SET archived = 1, archived_at = datetime(\'now\') WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE cards SET archived = 0, archived_at = NULL WHERE id = ?').run(id);
  }
  return { ok: true };
}

/** List all archived cards with board/column info. */
export function listArchivedCards(db: DatabaseSync): { cards: ArchivedCard[] } {
  const rows = db.prepare(
    `SELECT c.id, c.title, c.description, c.due_date, c.labels, c.archived_at,
            col.title AS column_title, col.board_id, b.title AS board_title
     FROM cards c
     JOIN columns col ON c.column_id = col.id
     JOIN boards b ON col.board_id = b.id
     WHERE c.archived = 1
     ORDER BY c.archived_at DESC`
  ).all() as unknown as ArchivedCardRow[];

  const cards: ArchivedCard[] = rows.map((r: ArchivedCardRow) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    labels: JSON.parse(r.labels || '[]') as number[],
    archivedAt: r.archived_at || '',
    columnTitle: r.column_title,
    boardId: r.board_id,
    boardTitle: r.board_title,
  }));

  return { cards };
}
