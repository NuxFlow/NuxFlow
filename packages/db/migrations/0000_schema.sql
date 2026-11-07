CREATE TABLE `site_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_site_settings_site_key` ON `site_settings` (`site_id`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_settings_inbound_handle` ON `site_settings` (`value`) WHERE "site_settings"."key" = 'email.inbound_handle';--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`setup_completed` integer DEFAULT false NOT NULL,
	`setup_token_hash` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`hosting_plan_id` text,
	`settings` text,
	`move_state` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_domain_unique` ON `sites` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sites_primary` ON `sites` (`is_primary`) WHERE "sites"."is_primary" = 1;--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text DEFAULT '' NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_user` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_accounts_provider` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_issuer_account_id` ON `accounts` (`issuer`,`account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_site` ON `api_keys` (`site_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`aaguid` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_passkeys_user` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `site_auth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `site_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_invitations_site_user` ON `site_invitations` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_site_invitations_user` ON `site_invitations` (`user_id`);--> statement-breakpoint
CREATE TABLE `site_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_sessions_token_hash_unique` ON `site_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_site_sessions_user` ON `site_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_site_sessions_parent` ON `site_sessions` (`parent_session_id`);--> statement-breakpoint
CREATE TABLE `user_site_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_site_roles_user_site` ON `user_site_roles` (`user_id`,`site_id`);--> statement-breakpoint
CREATE INDEX `idx_user_site_roles_site` ON `user_site_roles` (`site_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`phone` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_verifications_identifier` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`item_id` text NOT NULL,
	`author_id` text,
	`parent_id` text,
	`guest_name` text,
	`guest_email` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_comments_item` ON `comments` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_comments_site_status` ON `comments` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_comments_site_parent` ON `comments` (`site_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`type_id` text NOT NULL,
	`author_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`content` text,
	`excerpt` text,
	`seo_title` text,
	`seo_description` text,
	`og_image` text,
	`published_at` text,
	`scheduled_at` text,
	`preview_token` text,
	`preview_token_expires_at` text,
	`settings` text,
	`allow_comments` integer,
	`locale` text DEFAULT 'en' NOT NULL,
	`source_item_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`event_start_at` text,
	`event_end_at` text,
	`event_location` text,
	`event_url` text,
	`event_all_day` integer,
	`event_rsvp_enabled` integer,
	`event_rsvp_capacity` integer,
	`event_rsvp_closes_at` text,
	`event_recurrence` text,
	`event_price` real,
	`event_currency` text,
	`event_cancel_hours` integer,
	`event_passes_allowed` integer,
	`event_pass_credits` integer,
	`event_teacher_id` text,
	`event_room_id` text,
	`canonical_url` text,
	`focus_keyword` text,
	`meta_robots` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_content_items_site_type` ON `content_items` (`site_id`,`type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_content_items_site_slug_unique` ON `content_items` (`site_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_content_items_site_status` ON `content_items` (`site_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_content_items_locale` ON `content_items` (`site_id`,`locale`);--> statement-breakpoint
CREATE INDEX `idx_content_items_source` ON `content_items` (`source_item_id`);--> statement-breakpoint
CREATE INDEX `idx_content_items_site_updated` ON `content_items` (`site_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_items_event_start` ON `content_items` (`site_id`,`event_start_at`);--> statement-breakpoint
CREATE INDEX `idx_content_items_site_status_visibility_published` ON `content_items` (`site_id`,`status`,`visibility`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_content_items_site_type_status_updated` ON `content_items` (`site_id`,`type_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_content_items_scheduled` ON `content_items` (`scheduled_at`) WHERE "content_items"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX `idx_content_items_event_teacher` ON `content_items` (`site_id`,`event_teacher_id`) WHERE event_teacher_id is not null;--> statement-breakpoint
CREATE INDEX `idx_content_items_event_room` ON `content_items` (`site_id`,`event_room_id`) WHERE event_room_id is not null;--> statement-breakpoint
CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`author_id` text,
	`content` text,
	`title` text NOT NULL,
	`summary` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_content_revisions_item` ON `content_revisions` (`item_id`);--> statement-breakpoint
CREATE TABLE `content_taxonomy_terms` (
	`content_item_id` text NOT NULL,
	`term_id` text NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`term_id`) REFERENCES `taxonomy_terms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ctt_item` ON `content_taxonomy_terms` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `idx_ctt_term` ON `content_taxonomy_terms` (`term_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ctt_item_term` ON `content_taxonomy_terms` (`content_item_id`,`term_id`);--> statement-breakpoint
CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`singular_name` text NOT NULL,
	`icon` text,
	`is_built_in` integer DEFAULT false NOT NULL,
	`has_revisions` integer DEFAULT true NOT NULL,
	`has_comments` integer DEFAULT false NOT NULL,
	`schema` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_content_types_site_slug` ON `content_types` (`site_id`,`slug`);--> statement-breakpoint
CREATE TABLE `event_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`image_url` text,
	`capacity` integer,
	`user_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_resources_site_kind` ON `event_resources` (`site_id`,`kind`,`sort_order`);--> statement-breakpoint
CREATE TABLE `event_rsvps` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`seats` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`occurrence_date` text DEFAULT '' NOT NULL,
	`starts_at` text,
	`hold_expires_at` text,
	`payment_method` text,
	`payment_status` text,
	`amount_paid` real,
	`currency` text,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`pass_holding_id` text,
	`credits_spent` integer DEFAULT 0 NOT NULL,
	`attendance` text,
	`attendance_at` text,
	`amount_discount` real,
	`discount_code` text,
	`amount_tax` real,
	`payment_provider` text,
	`provider_order_id` text,
	`reminder_sent_at` text,
	`confirm_sent_at` text,
	`confirmed_at` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_event_rsvps_item_date_email` ON `event_rsvps` (`content_item_id`,`occurrence_date`,`email`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_site_item_status` ON `event_rsvps` (`site_id`,`content_item_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_site_email` ON `event_rsvps` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_payment_intent` ON `event_rsvps` (`site_id`,`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_holds` ON `event_rsvps` (`hold_expires_at`) WHERE status in ('held', 'offered');--> statement-breakpoint
CREATE INDEX `idx_event_rsvps_reminders` ON `event_rsvps` (`starts_at`) WHERE status = 'confirmed' and reminder_sent_at is null;--> statement-breakpoint
CREATE TABLE `menus` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`items` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_menus_site` ON `menus` (`site_id`);--> statement-breakpoint
CREATE TABLE `redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`status_code` integer DEFAULT 301 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_redirects_site_from` ON `redirects` (`site_id`,`from`);--> statement-breakpoint
CREATE TABLE `taxonomies` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_hierarchical` integer DEFAULT false NOT NULL,
	`noindex` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_taxonomies_site_slug` ON `taxonomies` (`site_id`,`slug`);--> statement-breakpoint
CREATE TABLE `taxonomy_content_types` (
	`taxonomy_id` text NOT NULL,
	`content_type_id` text NOT NULL,
	FOREIGN KEY (`taxonomy_id`) REFERENCES `taxonomies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_type_id`) REFERENCES `content_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_taxonomy_content_types_unique` ON `taxonomy_content_types` (`taxonomy_id`,`content_type_id`);--> statement-breakpoint
CREATE INDEX `idx_taxonomy_content_types_type` ON `taxonomy_content_types` (`content_type_id`);--> statement-breakpoint
CREATE TABLE `taxonomy_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`taxonomy_id` text NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`og_image` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`taxonomy_id`) REFERENCES `taxonomies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_taxonomy_terms_taxonomy` ON `taxonomy_terms` (`taxonomy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_taxonomy_terms_taxonomy_slug_unique` ON `taxonomy_terms` (`taxonomy_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_taxonomy_terms_taxonomy_parent` ON `taxonomy_terms` (`taxonomy_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`uploaded_by` text,
	`filename` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`url` text NOT NULL,
	`storage_provider` text DEFAULT 'cloudflare' NOT NULL,
	`storage_key` text NOT NULL,
	`alt_text` text,
	`caption` text,
	`focal_x` integer,
	`focal_y` integer,
	`folder_id` text,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_media_site_folder` ON `media` (`site_id`,`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_media_folder` ON `media` (`folder_id`);--> statement-breakpoint
CREATE TABLE `media_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_folders_site` ON `media_folders` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_media_folders_site_parent` ON `media_folders` (`site_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `video_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`uploaded_by` text,
	`cloudflare_stream_id` text NOT NULL,
	`title` text NOT NULL,
	`duration` integer,
	`thumbnail_url` text,
	`status` text DEFAULT 'uploading' NOT NULL,
	`size` integer,
	`is_private` integer DEFAULT false NOT NULL,
	`stream_account` text DEFAULT 'site' NOT NULL,
	`watch_paused` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_video_assets_site` ON `video_assets` (`site_id`);--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text,
	`data` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_form_submissions_form` ON `form_submissions` (`form_id`);--> statement-breakpoint
CREATE INDEX `idx_form_submissions_site` ON `form_submissions` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_form_submissions_form_status` ON `form_submissions` (`form_id`,`status`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`notifications` text,
	`redirect_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_forms_site_slug` ON `forms` (`site_id`,`slug`);--> statement-breakpoint
CREATE TABLE `ai_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`type` text DEFAULT 'page' NOT NULL,
	`plan` text,
	`tone` text,
	`locked_until` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`generated_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`content_item_ids` text,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_gen_jobs_site` ON `ai_generation_jobs` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_gen_jobs_user_site` ON `ai_generation_jobs` (`user_id`,`site_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`resource_id` text,
	`before` text,
	`after` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_site_created` ON `audit_logs` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_resource` ON `audit_logs` (`resource`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_site_user` ON `audit_logs` (`site_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `consent_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`analytics` integer NOT NULL,
	`marketing` integer NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_consent_logs_site_created` ON `consent_logs` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `crawler_hits` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`bot` text NOT NULL,
	`category` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`last_path` text,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `bot`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_crawler_hits_day` ON `crawler_hits` (`day`);--> statement-breakpoint
CREATE TABLE `dynamic_plugin_trust` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`publisher_public_key` text NOT NULL,
	`first_installed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dynamic_plugin_trust_site_plugin` ON `dynamic_plugin_trust` (`site_id`,`plugin_id`);--> statement-breakpoint
CREATE TABLE `dynamic_plugins` (
	`id` text NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`has_server` integer DEFAULT false NOT NULL,
	`has_client` integer DEFAULT false NOT NULL,
	`server_checksum` text,
	`client_checksum` text,
	`block_definitions` text,
	`definitions_checksum` text,
	`publisher_public_key` text DEFAULT '' NOT NULL,
	`signature` text DEFAULT '' NOT NULL,
	`installed_at` text DEFAULT (datetime('now')) NOT NULL,
	`capabilities` text,
	`capabilities_checksum` text,
	`granted_permissions` text,
	`settings_values` text,
	`updated_at` text,
	PRIMARY KEY(`site_id`, `id`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`data` text,
	`read_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_site` ON `notifications` (`user_id`,`site_id`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_storage` (
	`site_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`size` integer NOT NULL,
	`expires_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `plugin_id`, `key`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plugin_storage_expires` ON `plugin_storage` (`expires_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_push_subs_site` ON `push_subscriptions` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_push_subs_user_site` ON `push_subscriptions` (`user_id`,`site_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_directory` (
	`hostname` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`pool_site_id` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`moved_site_id` text NOT NULL,
	`site_name` text NOT NULL,
	`site_domain` text NOT NULL,
	`from_pool` text,
	`to_pool` text,
	`phase` text NOT NULL,
	`cursor` text,
	`counts` text,
	`error` text,
	`copy_files` integer DEFAULT false NOT NULL,
	`started_by` text,
	`locked_at` text,
	`copy_started_at` text,
	`switched_at` text,
	`locked_until` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_moves_active` ON `site_moves` (`moved_site_id`) WHERE "site_moves"."phase" not in ('done', 'cancelled');--> statement-breakpoint
CREATE TABLE `site_usage_daily` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `metric`),
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_site_usage_daily_day` ON `site_usage_daily` (`day`);--> statement-breakpoint
CREATE TABLE `themes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`package_name` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`has_css` integer DEFAULT false NOT NULL,
	`css_version` integer DEFAULT 0 NOT NULL,
	`settings` text,
	`installed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_themes_site` ON `themes` (`site_id`);--> statement-breakpoint
CREATE TABLE `class_pass_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`pass_id` text,
	`pass_name` text NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`credits_total` integer NOT NULL,
	`credits_used` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`amount_paid` real DEFAULT 0 NOT NULL,
	`amount_refunded` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`stripe_session_id` text,
	`stripe_payment_intent_id` text,
	`allowed_term_ids` text,
	`amount_discount` real,
	`discount_code` text,
	`amount_tax` real,
	`payment_provider` text,
	`provider_order_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_class_pass_holdings_site_email` ON `class_pass_holdings` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_class_pass_holdings_payment_intent` ON `class_pass_holdings` (`site_id`,`stripe_payment_intent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_class_pass_holdings_session` ON `class_pass_holdings` (`site_id`,`stripe_session_id`) WHERE stripe_session_id is not null;--> statement-breakpoint
CREATE TABLE `class_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`credits` integer NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`valid_days` integer,
	`intro_only` integer DEFAULT false NOT NULL,
	`allowed_term_ids` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_class_passes_site` ON `class_passes` (`site_id`);--> statement-breakpoint
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
	`ls_product_id` text,
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
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tier_id`) REFERENCES `membership_tiers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_site_user` ON `subscriptions` (`site_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_provider_id` ON `subscriptions` (`provider`,`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_site_status` ON `subscriptions` (`site_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subscriptions_unique_provider_sub` ON `subscriptions` (`site_id`,`provider`,`provider_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_subscriptions_unique_free_tier` ON `subscriptions` (`site_id`,`user_id`,`tier_id`) WHERE substr("subscriptions"."provider_subscription_id", 1, 5) = 'free_';--> statement-breakpoint
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
	`stored_bytes` integer DEFAULT 0 NOT NULL,
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
CREATE UNIQUE INDEX `uq_mailboxes_site_local` ON `mailboxes` (`site_id`,`local_part`);--> statement-breakpoint
CREATE TABLE `mailing_list_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'popup' NOT NULL,
	`source_path` text,
	`consent_text` text,
	`ip_address` text,
	`confirm_sent_at` text,
	`confirmed_at` text,
	`unsubscribed_at` text,
	`synced_at` text,
	`sync_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_mailing_list_site_email` ON `mailing_list_subscribers` (`site_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_mailing_list_site_status` ON `mailing_list_subscribers` (`site_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `hosting_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_text` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`max_storage_bytes` integer,
	`max_content_items` integer,
	`max_team_members` integer,
	`max_site_members` integer,
	`max_plugins` integer,
	`max_ai_calls_per_month` integer,
	`max_emails_per_month` integer,
	`max_inbound_emails_per_month` integer,
	`max_visitor_ai_credits_per_month` integer,
	`max_views_per_month` integer,
	`max_renders_per_month` integer,
	`max_plugin_calls_per_month` integer,
	`max_database_bytes` integer,
	`max_custom_domains` integer,
	`max_video_minutes` integer DEFAULT 0,
	`max_video_minutes_watched_per_month` integer DEFAULT 0,
	`allow_image_transformations` integer DEFAULT false NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`price_monthly` real,
	`price_yearly` real,
	`currency` text DEFAULT 'gbp' NOT NULL,
	`trial_days` integer DEFAULT 0 NOT NULL,
	`stripe_product_id` text,
	`stripe_price_monthly_id` text,
	`stripe_price_yearly_id` text,
	`default_pool_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `site_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`hostname` text NOT NULL,
	`kind` text NOT NULL,
	`cf_custom_hostname_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`ssl_status` text,
	`verification_errors` text,
	`last_checked_at` text,
	`live_notified_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_domains_hostname` ON `site_domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `idx_site_domains_site` ON `site_domains` (`site_id`);