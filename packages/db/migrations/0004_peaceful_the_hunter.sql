ALTER TABLE `content_items` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_content_items_site_updated` ON `content_items` (`site_id`,`updated_at`);