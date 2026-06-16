CREATE TABLE `ai_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`type` text DEFAULT 'page' NOT NULL,
	`plan` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`generated_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`content_item_ids` text,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_gen_jobs_site` ON `ai_generation_jobs` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_gen_jobs_user_site` ON `ai_generation_jobs` (`user_id`,`site_id`);