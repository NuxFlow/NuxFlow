-- De-dupe before the unique index below, or CREATE UNIQUE INDEX hard-fails on any
-- existing database that already has duplicate (user_id, site_id) rows — exactly the
-- TOCTOU race this migration's own unique constraint is closing (two concurrent invites
-- for the same not-yet-member email/site could both pass a "not already a member" check
-- and both insert). Keeps the highest-ranked role per duplicate pair (never silently
-- downgrades anyone), tie-broken by earliest-created, then lowest id, for determinism.
DELETE FROM `user_site_roles`
WHERE `id` NOT IN (
	SELECT `id` FROM (
		SELECT `id`,
			ROW_NUMBER() OVER (
				PARTITION BY `user_id`, `site_id`
				ORDER BY
					CASE `role`
						WHEN 'super_admin' THEN 100
						WHEN 'admin' THEN 80
						WHEN 'editor' THEN 60
						WHEN 'author' THEN 40
						WHEN 'member' THEN 20
						WHEN 'viewer' THEN 10
						ELSE 0
					END DESC,
					`created_at` ASC,
					`id` ASC
			) AS `rn`
		FROM `user_site_roles`
	)
	WHERE `rn` = 1
);--> statement-breakpoint
DROP INDEX `idx_user_site_roles_user_site`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_site_roles_user_site` ON `user_site_roles` (`user_id`,`site_id`);