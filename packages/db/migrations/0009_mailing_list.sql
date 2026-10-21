CREATE TABLE `mailing_list_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'popup' NOT NULL,
	`source_path` text,
	`consent_text` text,
	`ip_address` text,
	`confirm_sent_at` text,
	`confirmed_at` text,
	`unsubscribed_at` text,
	`synced_at` text,
	`sync_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mailing_list_site_email` ON `mailing_list_subscribers` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_mailing_list_site_status` ON `mailing_list_subscribers` (`site_id`,`status`,`created_at`);