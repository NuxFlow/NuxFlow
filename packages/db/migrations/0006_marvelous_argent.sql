ALTER TABLE `content_items` ADD `event_start_at` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_end_at` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_location` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_url` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_all_day` integer;--> statement-breakpoint
CREATE INDEX `idx_content_items_event_start` ON `content_items` (`site_id`,`event_start_at`);