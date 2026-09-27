CREATE TABLE `crawler_hits` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`bot` text NOT NULL,
	`category` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_path` text,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `bot`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_crawler_hits_day` ON `crawler_hits` (`day`);