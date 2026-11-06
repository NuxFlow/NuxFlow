CREATE TABLE `class_pass_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`pass_id` text,
	`pass_name` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`credits_total` integer NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`amount_paid` real DEFAULT 0 NOT NULL,
	`amount_refunded` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_class_pass_holdings_site_email` ON `class_pass_holdings` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_class_pass_holdings_payment_intent` ON `class_pass_holdings` (`site_id`,`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_class_pass_holdings_session` ON `class_pass_holdings` (`site_id`,`stripe_session_id`) WHERE stripe_session_id is not null;--> statement-breakpoint
CREATE TABLE `class_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`credits` integer NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`valid_days` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_class_passes_site` ON `class_passes` (`site_id`);--> statement-breakpoint
DROP INDEX `uq_event_rsvps_item_email`;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `occurrence_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `starts_at` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `hold_expires_at` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `payment_status` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `amount_paid` real;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `currency` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `pass_holding_id` text;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `credits_spent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `event_rsvps` ADD `reminder_sent_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_rsvps_item_date_email` ON `event_rsvps` (`content_item_id`,`occurrence_date`,`email`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_site_email` ON `event_rsvps` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_payment_intent` ON `event_rsvps` (`site_id`,`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_holds` ON `event_rsvps` (`hold_expires_at`) WHERE status in ('held', 'offered');--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_reminders` ON `event_rsvps` (`starts_at`) WHERE status = 'confirmed' and reminder_sent_at is null;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_recurrence` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_price` real;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_currency` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_cancel_hours` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `event_passes_allowed` integer;--> statement-breakpoint
UPDATE `event_rsvps` SET `starts_at` = (SELECT `event_start_at` FROM `content_items` WHERE `content_items`.`id` = `event_rsvps`.`content_item_id`) WHERE `starts_at` IS NULL;
