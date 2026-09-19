DROP INDEX `idx_audit_logs_site`;--> statement-breakpoint
CREATE INDEX `idx_audit_logs_site_created` ON `audit_logs` (`site_id`,`created_at`);