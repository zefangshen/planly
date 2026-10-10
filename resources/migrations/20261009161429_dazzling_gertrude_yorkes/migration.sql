CREATE TABLE `all_card_order` (
	`card_id` text PRIMARY KEY,
	`status` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `fk_all_card_order_card_id_cards_id_fk` FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON DELETE CASCADE
);
