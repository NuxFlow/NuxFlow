CREATE TABLE `availability_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`feed_id` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `availability_feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_availability_blocks_item` ON `availability_blocks` (`content_item_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_availability_blocks_site` ON `availability_blocks` (`site_id`);--> statement-breakpoint
CREATE TABLE `availability_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`url` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_availability_feeds_item` ON `availability_feeds` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `idx_availability_feeds_site` ON `availability_feeds` (`site_id`);