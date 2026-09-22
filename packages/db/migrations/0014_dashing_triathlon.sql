DROP INDEX IF EXISTS `idx_content_items_site_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_content_items_site_slug_unique` ON `content_items` (`site_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_taxonomy_terms_taxonomy_slug_unique` ON `taxonomy_terms` (`taxonomy_id`,`slug`);