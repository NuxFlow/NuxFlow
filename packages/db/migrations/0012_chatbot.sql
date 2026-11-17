CREATE TABLE `chat_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`n` integer NOT NULL,
	`title` text NOT NULL,
	`path` text,
	`text` text NOT NULL,
	`hash` text NOT NULL,
	`source_updated_at` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_chunks_source` ON `chat_chunks` (`site_id`,`source_kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`visitor_token_hash` text NOT NULL,
	`page_path` text DEFAULT '/' NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`lead_name` text,
	`lead_email` text,
	`lead_at` text,
	`inbox_thread_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_message_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_site` ON `chat_conversations` (`site_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_conversations_last` ON `chat_conversations` (`last_message_at`);--> statement-breakpoint
CREATE TABLE `chat_knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text DEFAULT 'faq' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_knowledge_site` ON `chat_knowledge` (`site_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`sources` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `chat_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_conversation` ON `chat_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `max_chat_credits_per_month` integer;--> statement-breakpoint
ALTER TABLE `hosting_plans` ADD `allow_chatbot` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_site_settings_key` ON `site_settings` (`key`,`site_id`);