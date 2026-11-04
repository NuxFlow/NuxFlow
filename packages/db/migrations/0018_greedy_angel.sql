CREATE TABLE `event_rsvps` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirm_sent_at` text,
	`confirmed_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_rsvps_item_email` ON `event_rsvps` (`content_item_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_site_item_status` ON `event_rsvps` (`site_id`,`content_item_id`,`status`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_rsvp_enabled` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_rsvp_capacity` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_rsvp_closes_at` text;