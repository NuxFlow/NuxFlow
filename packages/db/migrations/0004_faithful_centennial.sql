ALTER TABLE `accounts` ADD `access_token_expires_at` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `refresh_token_expires_at` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `scope` text;