import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 * - schema: source of truth for table definitions
 * - out: migration output folder (shipped to the packaged app via extraResources)
 * - dialect: sqlite (node:sqlite DatabaseSync at runtime)
 * - dbCredentials.url: only used by `drizzle-kit push`/`migrate`/`studio`/`pull`
 */
export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './resources/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './planly.db',
  },
});
