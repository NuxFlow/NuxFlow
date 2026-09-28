-- Inbound email handles route mail for <handle>+<mailbox>@<platform domain> by value
-- across every site, so they must be unique. Before this index existed a tenant could copy
-- another tenant's handle through the settings API; keep the earliest row for any
-- duplicated handle (the one mail was already being routed to) and drop the rest — those
-- sites get a fresh handle lazily from ensureInboundHandle() on next use.
DELETE FROM `site_settings` WHERE `key` = 'email.inbound_handle' AND rowid NOT IN (SELECT MIN(rowid) FROM `site_settings` WHERE `key` = 'email.inbound_handle' GROUP BY `value`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_settings_inbound_handle` ON `site_settings` (`value`) WHERE `key` = 'email.inbound_handle';
