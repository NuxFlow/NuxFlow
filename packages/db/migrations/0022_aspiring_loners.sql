CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`email` integer DEFAULT true NOT NULL,
	`push` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notification_prefs` ON `notification_preferences` (`user_id`,`site_id`,`type`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`provider_message_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_email_log_site_created` ON `email_log` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`mailbox_id` text,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_id` text,
	`in_reply_to` text,
	`references` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_address` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`text_body` text,
	`html_body` text,
	`attachments` text,
	`auth` text,
	`status` text DEFAULT 'new' NOT NULL,
	`category` text,
	`ai_summary` text,
	`raw_key` text,
	`size` integer DEFAULT 0 NOT NULL,
	`sent_by_user_id` text,
	`content_item_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sent_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_email_messages_site_status` ON `email_messages` (`site_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_email_messages_thread` ON `email_messages` (`site_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_email_messages_message_id` ON `email_messages` (`site_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`local_part` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'inbox' NOT NULL,
	`user_id` text,
	`forward_to` text,
	`notify` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mailboxes_site_local` ON `mailboxes` (`site_id`,`local_part`);