ALTER TABLE `orders` ADD `fulfilment` text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `collect_at` text;