CREATE TABLE `gallery_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`block_id` text NOT NULL,
	`picker_token_hash` text NOT NULL,
	`picker_name` text NOT NULL,
	`photos` text DEFAULT '[]' NOT NULL,
	`note` text,
	`submitted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_gallery_picks_picker` ON `gallery_picks` (`content_item_id`,`block_id`,`picker_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_gallery_picks_site` ON `gallery_picks` (`site_id`);