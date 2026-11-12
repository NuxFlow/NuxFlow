CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`block_id` text NOT NULL,
	`service_name` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`blocked_until` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`price` real,
	`currency` text,
	`cancel_hours` integer DEFAULT 0 NOT NULL,
	`payment_status` text,
	`amount_paid` real,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`hold_expires_at` text,
	`confirm_sent_at` text,
	`confirmed_at` text,
	`reminder_sent_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_appointments_site_start` ON `appointments` (`site_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `idx_appointments_site_email` ON `appointments` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_appointments_payment` ON `appointments` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_appointments_reminder` ON `appointments` (`starts_at`) WHERE status = 'confirmed' AND reminder_sent_at IS NULL;