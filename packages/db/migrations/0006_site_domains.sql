CREATE TABLE `site_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`hostname` text NOT NULL,
	`kind` text NOT NULL,
	`cf_custom_hostname_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`ssl_status` text,
	`verification_errors` text,
	`last_checked_at` text,
	`live_notified_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_domains_hostname` ON `site_domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `idx_site_domains_site` ON `site_domains` (`site_id`);--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_custom_domains` integer;