CREATE TABLE `hosting_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`interval` text NOT NULL,
	`status` text DEFAULT 'checkout' NOT NULL,
	`requested_subdomain` text NOT NULL,
	`requested_site_name` text NOT NULL,
	`template` text DEFAULT 'landing' NOT NULL,
	`hosted_site_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_checkout_session_id` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`past_due_since` text,
	`paused_for_non_payment` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosting_subscriptions_stripe_subscription_id_unique` ON `hosting_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hosting_subscriptions_stripe_checkout_session_id_unique` ON `hosting_subscriptions` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `idx_hosting_subscriptions_owner` ON `hosting_subscriptions` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_hosting_subscriptions_site` ON `hosting_subscriptions` (`hosted_site_id`);--> statement-breakpoint
CREATE INDEX `idx_hosting_subscriptions_subdomain` ON `hosting_subscriptions` (`requested_subdomain`);--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `is_public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `price_monthly` real;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `price_yearly` real;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `currency` text DEFAULT 'gbp' NOT NULL;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `trial_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `stripe_product_id` text;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `stripe_price_monthly_id` text;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `stripe_price_yearly_id` text;