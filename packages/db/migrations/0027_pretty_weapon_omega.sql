-- At most one primary site (see sites.is_primary).
CREATE UNIQUE INDEX `idx_sites_primary` ON `sites` (`is_primary`) WHERE `is_primary` = 1;
