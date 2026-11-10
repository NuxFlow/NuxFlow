ALTER TABLE `order_lines` ADD `product_id` text;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `is_digital` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `stock_taken` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `downloads` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `hold_expires_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_address` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `terms_accepted_at` text;--> statement-breakpoint
CREATE INDEX `idx_orders_pending_hold` ON `orders` (`hold_expires_at`) WHERE status = 'pending' and hold_expires_at is not null;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `file_key` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `product_variants` ADD `file_size` integer;