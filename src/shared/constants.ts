import type { CardStatus } from './types/board';

/** Virtual (non-persisted) board that aggregates cards across every real board. */
export const ALL_BOARD_ID = 'all';

/** Synthetic column ids in the All board are `all:<status>`. */
export const ALL_COLUMN_PREFIX = 'all:';

/** Canonical status buckets of the All board, in display order. */
export const CARD_STATUSES: { key: CardStatus; title: string }[] = [
  { key: 'todo', title: 'To Do' },
  { key: 'in_progress', title: 'In Progress' },
  { key: 'done', title: 'Done' },
];

/** Normalize a column title for matching against canonical statuses. */
export function normalizeColumnTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Map a real column title to a canonical status, or null if it doesn't match. */
export function statusFromColumnTitle(title: string): CardStatus | null {
  const normalized = normalizeColumnTitle(title);
  const match = CARD_STATUSES.find(s => normalizeColumnTitle(s.title) === normalized);
  return match ? match.key : null;
}

export interface LabelColor {
  name: string;
  color: string;
}

export const LABEL_COLORS: LabelColor[] = [
  { name: 'Green',  color: '#61bd4f' },
  { name: 'Yellow', color: '#f5cd28' },
  { name: 'Orange', color: '#ff9f1a' },
  { name: 'Red',    color: '#eb5a46' },
  { name: 'Purple', color: '#c377e0' },
  { name: 'Blue',   color: '#0079bf' },
  { name: 'Sky',    color: '#00c2e8' },
  { name: 'Black',  color: '#172b4d' },
];
