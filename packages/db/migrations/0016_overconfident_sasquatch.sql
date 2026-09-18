CREATE INDEX `idx_comments_site_parent` ON `comments` (`site_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_taxonomy_terms_taxonomy_parent` ON `taxonomy_terms` (`taxonomy_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_media_folders_site_parent` ON `media_folders` (`site_id`,`parent_id`);