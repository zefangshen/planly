import type { DatabaseSync } from 'node:sqlite';
import { registerBoardsIpc } from './boards';
import { registerColumnsIpc } from './columns';
import { registerCardsIpc } from './cards';

/**
 * One channel per renderer API method; each handler delegates to the services.
 * Errors thrown by service functions reject the invoke promise, so the renderer
 * receives the original error message.
 */
export function registerIpc(db: DatabaseSync): void {
  registerBoardsIpc(db);
  registerColumnsIpc(db);
  registerCardsIpc(db);
}
