CREATE TABLE `starter_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text,
	`starter_id` text NOT NULL,
	`mode` text DEFAULT 'switch' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`manifest` text,
	`image_urls` text,
	`images_done` integer DEFAULT 0 NOT NULL,
	`images_total` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_starter_installs_open` ON `starter_installs` (`site_id`) WHERE "starter_installs"."status" in ('pending', 'running');