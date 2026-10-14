CREATE TABLE `site_usage_daily` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `metric`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_site_usage_daily_day` ON `site_usage_daily` (`day`);