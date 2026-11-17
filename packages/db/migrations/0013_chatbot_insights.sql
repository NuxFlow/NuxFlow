ALTER TABLE `chat_knowledge` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `chat_knowledge` ADD `file_size` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `unanswered` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `rating` integer;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `reviewed_at` text;--> statement-breakpoint
CREATE INDEX `idx_chat_messages_review` ON `chat_messages` (`site_id`,`created_at`) WHERE role = 'assistant' AND reviewed_at IS NULL AND (unanswered = 1 OR rating = -1);