-- Rebuilds dynamic_plugins with a (site_id, id) primary key so each site can install a
-- given plugin id independently. Safe to rebuild: no table has a FK to dynamic_plugins,
-- so the implicit DELETE of the old table's DROP triggers no cascade anywhere (see the
-- migration notes in CLAUDE.md). PRAGMA foreign_keys lines dropped — a no-op on D1.
CREATE TABLE `__new_dynamic_plugins` (
	`id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`has_server` integer DEFAULT false NOT NULL,
	`has_client` integer DEFAULT false NOT NULL,
	`server_checksum` text,
	`client_checksum` text,
	`block_definitions` text,
	`definitions_checksum` text,
	`publisher_public_key` text DEFAULT '' NOT NULL,
	`signature` text DEFAULT '' NOT NULL,
	`installed_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `id`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR IGNORE INTO `__new_dynamic_plugins`("id", "site_id", "name", "version", "description", "is_active", "has_server", "has_client", "server_checksum", "client_checksum", "block_definitions", "definitions_checksum", "publisher_public_key", "signature", "installed_at") SELECT "id", "site_id", "name", "version", "description", "is_active", "has_server", "has_client", "server_checksum", "client_checksum", "block_definitions", "definitions_checksum", "publisher_public_key", "signature", "installed_at" FROM `dynamic_plugins`;--> statement-breakpoint
DROP TABLE `dynamic_plugins`;--> statement-breakpoint
ALTER TABLE `__new_dynamic_plugins` RENAME TO `dynamic_plugins`;