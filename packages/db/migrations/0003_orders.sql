CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`record_id` text,
	`name` text NOT NULL,
	`description` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_order_lines_order` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_order_lines_site_kind` ON `order_lines` (`site_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_order_lines_record` ON `order_lines` (`site_id`,`record_id`);--> statement-breakpoint
CREATE TABLE `order_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`site_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reason` text,
	`stripe_refund_id` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_order_refunds_order` ON `order_refunds` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_order_refunds_stripe` ON `order_refunds` (`site_id`,`stripe_refund_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`user_id` text,
	`currency` text NOT NULL,
	`subtotal_minor` integer DEFAULT 0 NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`shipping_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer DEFAULT 0 NOT NULL,
	`refunded_minor` integer DEFAULT 0 NOT NULL,
	`stripe_refunded_minor` integer DEFAULT 0 NOT NULL,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`paid_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_orders_site_number` ON `orders` (`site_id`,`number`);--> statement-breakpoint
CREATE INDEX `idx_orders_site_created` ON `orders` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_orders_site_status` ON `orders` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_orders_site_email` ON `orders` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_orders_session` ON `orders` (`site_id`,`stripe_session_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_payment_intent` ON `orders` (`site_id`,`stripe_payment_intent_id`);