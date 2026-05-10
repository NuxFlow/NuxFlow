CREATE TABLE `membership_tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`interval` text DEFAULT 'month' NOT NULL,
	`features` text DEFAULT '[]' NOT NULL,
	`stripe_product_id` text,
	`stripe_price_id` text,
	`ls_variant_id` text,
	`paddle_product_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_membership_tiers_site` ON `membership_tiers` (`site_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tier_id` text,
	`provider` text NOT NULL,
	`provider_subscription_id` text NOT NULL,
	`provider_customer_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_start` text,
	`current_period_end` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tier_id`) REFERENCES `membership_tiers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_site_user` ON `subscriptions` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_provider_id` ON `subscriptions` (`provider`,`provider_subscription_id`);