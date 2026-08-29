ALTER TABLE `accounts` ADD `issuer` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill issuer for rows created before Better Auth 1.7's account-identity-by-issuer
-- change. Built-in social providers (google, github) have no OIDC issuer of their own,
-- so Better Auth synthesizes `local:oauth:<providerId>`; email/password accounts get
-- `local:credential`. Must run before the unique index below, or every pre-existing
-- row's default '' issuer collides on the first duplicate (provider_id, account_id) pair.
UPDATE `accounts` SET `issuer` = CASE
  WHEN `provider_id` = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || `provider_id`
END
WHERE `issuer` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_issuer_account_id` ON `accounts` (`issuer`,`account_id`);