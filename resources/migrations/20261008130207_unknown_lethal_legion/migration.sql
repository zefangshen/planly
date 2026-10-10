CREATE TABLE IF NOT EXISTS `boards` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cards` (
	`id` text PRIMARY KEY,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '',
	`due_date` text DEFAULT '',
	`labels` text DEFAULT '[]',
	`position` integer NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	CONSTRAINT `fk_cards_column_id_columns_id_fk` FOREIGN KEY (`column_id`) REFERENCES `columns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `columns` (
	`id` text PRIMARY KEY,
	`board_id` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `fk_columns_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE
);
