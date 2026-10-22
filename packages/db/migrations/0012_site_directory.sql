CREATE TABLE `site_directory` (
	`hostname` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`pool_site_id` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
