ALTER TABLE `email_messages` ADD `stored_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_inbound_emails_per_month` integer;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_visitor_ai_credits_per_month` integer;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_plugin_calls_per_month` integer;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_database_bytes` integer;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `allow_image_transformations` integer DEFAULT false NOT NULL;