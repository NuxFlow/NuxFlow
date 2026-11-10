CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`sku` text,
	`options` text DEFAULT '[]' NOT NULL,
	`price_minor` integer NOT NULL,
	`compare_at_minor` integer,
	`stock` integer,
	`weight_grams` integer,
	`kind` text DEFAULT 'physical' NOT NULL,
	`image_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_product_variants_item` ON `product_variants` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `idx_product_variants_site_sku` ON `product_variants` (`site_id`,`sku`);--> statement-breakpoint
CREATE TABLE `products` (
	`content_item_id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`option_names` text DEFAULT '[]' NOT NULL,
	`images` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_products_site` ON `products` (`site_id`);--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_products` integer;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `allow_shop` integer DEFAULT false NOT NULL;