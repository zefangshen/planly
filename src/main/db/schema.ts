import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Planly database schema — source of truth for table definitions.
 * Migrations are generated from this file via `drizzle-kit generate`.
 *
 * Services currently use raw node:sqlite SQL (src/main/services/*-service.ts),
 * but the schema here guarantees the generated migrations stay in sync with
 * the expected table shape.
 */

export const boards = sqliteTable('boards', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
});

export const columns = sqliteTable('columns', {
  id: text('id').primaryKey(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  position: integer('position').notNull(),
});

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  columnId: text('column_id').notNull().references(() => columns.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').default(''),
  dueDate: text('due_date').default(''),
  labels: text('labels').default('[]'),
  position: integer('position').notNull(),
  archived: integer('archived').notNull().default(0),
  archivedAt: text('archived_at'),
});

/**
 * Persisted ordering for the virtual All board. Each row records which status
 * bucket ('todo' | 'in_progress' | 'done') a card appears in and its global
 * position within that bucket — independent of the card's position on its
 * home board, so users can freely interleave cards from different boards.
 * Rows are lazily created on first All-board load; cascade-deleted with the card.
 */
export const allCardOrder = sqliteTable('all_card_order', {
  cardId: text('card_id').primaryKey().references(() => cards.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  position: integer('position').notNull(),
});
