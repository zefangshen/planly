import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { z } from 'zod';
import { openDb, runMigrations } from '../main/services/database-service';
import { bootstrapLegacy } from '../main/services/legacy-bootstrap';
import { seed } from '../main/services/seed';
import { listBoards, getBoard, getAllBoard } from '../main/services/board-service';
import { createColumn, renameColumn, deleteColumn, moveColumn, archiveAllCards } from '../main/services/column-service';
import { createCard, updateCard, moveCard, moveAllCard, deleteCard, setCardArchived, listArchivedCards } from '../main/services/card-service';

// ---------------------------------------------------------------------------
// DB bootstrap
// ---------------------------------------------------------------------------

/**
 * DB path resolution:
 * 1. PLANLY_DB env var (explicit override)
 * 2. Shared app data dir — same location the packaged Electron app uses
 *    (~/Library/Application Support/planly/planly.db on macOS), so agents
 *    operate on the same database the desktop app has open.
 */
function resolveDbPath(): string {
  if (process.env.PLANLY_DB) return process.env.PLANLY_DB;
  return path.join(os.homedir(), 'Library', 'Application Support', 'planly', 'planly.db');
}

const DB_PATH = resolveDbPath();
// dist-mcp/mcp/server.js -> project root/resources/migrations (SQL migrations live outside dist-mcp)
const SQL_DIR = path.resolve(__dirname, '..', '..', 'resources', 'migrations');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);
bootstrapLegacy(db);
runMigrations(db, SQL_DIR, DB_PATH);
seed(db);

console.error(`[planly-mcp] DB: ${DB_PATH}`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Wrap a core call: JSON result on success, isError + message on failure. */
function result(fn: () => unknown): ToolResult {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(fn(), null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
  }
}

const cardInput = {
  title: z.string().min(1).describe('Card title'),
  description: z.string().optional().describe('Card description (markdown-ish plain text)'),
  dueDate: z.string().optional().describe('Due date as YYYY-MM-DD (empty string means none)'),
  labels: z.array(z.number()).optional().describe('Label color indexes (0-7)'),
};

// ---------------------------------------------------------------------------
// Server + tools
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'planly', version: '2.0.0' });

// Boards
server.registerTool(
  'list_boards',
  { description: 'List all Planly boards (id + title, ordered by position)' },
  () => result(() => listBoards(db))
);

server.registerTool(
  'get_board',
  {
    description: 'Load one board with all its columns and non-archived cards, ordered by position',
    inputSchema: { id: z.string().describe('Board id') },
  },
  ({ id }) => result(() => getBoard(db, id))
);

server.registerTool(
  'get_all_board',
  {
    description: 'Load the virtual All board: all non-archived cards aggregated into To Do / In Progress / Done buckets across every board; each card includes its boardId/boardTitle',
  },
  () => result(() => getAllBoard(db))
);

// Columns
server.registerTool(
  'create_column',
  {
    description: 'Create a new column (list) on a board, appended at the end',
    inputSchema: {
      boardId: z.string().describe('Board id'),
      title: z.string().min(1).describe('Column title'),
    },
  },
  ({ boardId, title }) => result(() => createColumn(db, boardId, title))
);

server.registerTool(
  'rename_column',
  {
    description: 'Rename a column',
    inputSchema: {
      id: z.string().describe('Column id'),
      title: z.string().min(1).describe('New column title'),
    },
  },
  ({ id, title }) => result(() => renameColumn(db, id, title))
);

server.registerTool(
  'delete_column',
  {
    description: 'Delete a column and all its cards (permanent)',
    inputSchema: { id: z.string().describe('Column id') },
  },
  ({ id }) => result(() => deleteColumn(db, id))
);

server.registerTool(
  'move_column',
  {
    description: 'Move/reorder a column within its board; place it before beforeColumnId, or at the end if omitted',
    inputSchema: {
      id: z.string().describe('Column id to move'),
      beforeColumnId: z.string().nullish().describe('Place the column before this column id, null/omit for end'),
    },
  },
  ({ id, beforeColumnId }) => result(() => moveColumn(db, id, beforeColumnId ?? null))
);

server.registerTool(
  'archive_all_cards',
  {
    description: 'Archive every non-archived card in a column; returns how many were archived',
    inputSchema: { colId: z.string().describe('Column id') },
  },
  ({ colId }) => result(() => archiveAllCards(db, colId))
);

// Cards
server.registerTool(
  'create_card',
  {
    description: 'Create a card in a column, appended at the bottom; returns the created card',
    inputSchema: { colId: z.string().describe('Column id'), ...cardInput },
  },
  ({ colId, ...data }) => result(() => createCard(db, colId, data))
);

server.registerTool(
  'update_card',
  {
    description: 'Update a card title/description/dueDate/labels (full replace of provided fields)',
    inputSchema: { id: z.string().describe('Card id'), ...cardInput },
  },
  ({ id, ...data }) => result(() => updateCard(db, id, data))
);

server.registerTool(
  'move_card',
  {
    description: 'Move a card into another column and/or position; place before beforeCardId, or at the end if omitted',
    inputSchema: {
      id: z.string().describe('Card id to move'),
      toColId: z.string().describe('Destination column id'),
      beforeCardId: z.string().nullish().describe('Place the card before this card id, null/omit for end'),
    },
  },
  ({ id, toColId, beforeCardId }) => result(() => moveCard(db, id, toColId, beforeCardId ?? null))
);

server.registerTool(
  'move_all_card',
  {
    description: 'Move or reorder a card in the virtual All board: free ordering within a status bucket or across buckets; cross-bucket moves also move the card to the matching column on its home board. Place before beforeCardId, or null/omit for end of bucket.',
    inputSchema: {
      id: z.string().describe('Card id to move'),
      status: z.enum(['todo', 'in_progress', 'done']).describe('Destination status bucket'),
      beforeCardId: z.string().nullish().describe('Place the card before this card id in the bucket, null/omit for end'),
    },
  },
  ({ id, status, beforeCardId }) => result(() => moveAllCard(db, id, status, beforeCardId ?? null))
);

server.registerTool(
  'delete_card',
  {
    description: 'Delete a card permanently',
    inputSchema: { id: z.string().describe('Card id') },
  },
  ({ id }) => result(() => deleteCard(db, id))
);

server.registerTool(
  'archive_card',
  {
    description: 'Archive or unarchive a card (archived cards are hidden from the board)',
    inputSchema: {
      id: z.string().describe('Card id'),
      archived: z.boolean().describe('true to archive, false to unarchive'),
    },
  },
  ({ id, archived }) => result(() => setCardArchived(db, id, archived))
);

server.registerTool(
  'restore_card',
  {
    description: 'Restore an archived card back to its column',
    inputSchema: { id: z.string().describe('Card id') },
  },
  ({ id }) => result(() => setCardArchived(db, id, false))
);

server.registerTool(
  'list_archived_cards',
  {
    description: 'List all archived cards across boards with board/column titles and archive timestamps',
  },
  () => result(() => listArchivedCards(db))
);

// ---------------------------------------------------------------------------
// Start (stdio — never log to stdout)
// ---------------------------------------------------------------------------

server.connect(new StdioServerTransport()).catch((e: Error) => {
  console.error('[planly-mcp] Failed to start:', e.message);
  process.exit(1);
});
console.error('[planly-mcp] Ready on stdio');
