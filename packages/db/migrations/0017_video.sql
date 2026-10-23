ALTER TABLE `video_assets` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `video_assets` ADD `stream_account` text DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE `video_assets` ADD `watch_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_video_minutes` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_video_minutes_watched_per_month` integer DEFAULT 0;