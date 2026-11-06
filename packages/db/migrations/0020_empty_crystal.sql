CREATE TABLE `event_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`image_url` text,
	`capacity` integer,
	`user_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_resources_site_kind` ON `event_resources` (`site_id`,`kind`,`sort_order`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_pass_credits` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_teacher_id` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_room_id` text;--> statement-breakpoint
CREATE INDEX `idx_content_items_event_teacher` ON `content_items` (`site_id`,`event_teacher_id`) WHERE event_teacher_id is not null;--> statement-breakpoint
CREATE INDEX `idx_content_items_event_room` ON `content_items` (`site_id`,`event_room_id`) WHERE event_room_id is not null;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `attendance` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `attendance_at` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `amount_discount` real;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `discount_code` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `amount_tax` real;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `payment_provider` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `provider_order_id` text;--> statement-breakpoint
ALTER TABLE `class_pass_holdings` ADD `allowed_term_ids` text;--> statement-breakpoint
ALTER TABLE `class_pass_holdings` ADD `amount_discount` real;--> statement-breakpoint
ALTER TABLE `class_pass_holdings` ADD `discount_code` text;--> statement-breakpoint
ALTER TABLE `class_pass_holdings` ADD `amount_tax` real;--> statement-breakpoint
ALTER TABLE `class_pass_holdings` ADD `payment_provider` text;--> statement-breakpoint
ALTER TABLE `class_pass_holdings` ADD `provider_order_id` text;--> statement-breakpoint
ALTER TABLE `class_passes` ADD `intro_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `class_passes` ADD `allowed_term_ids` text;