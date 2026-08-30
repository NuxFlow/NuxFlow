-- The public content gate branches on `visibility`, but no write path ever set it away from
-- its 'public' default (the editor UI only wrote `settings.access`) — so members/tier-gated
-- content was served fully public via the API. This backfills existing rows to match the
-- access level they were already configured with, now that the write paths keep them in sync.
UPDATE content_items
SET visibility = 'members'
WHERE visibility = 'public'
  AND json_extract(settings, '$.access') IS NOT NULL
  AND json_extract(settings, '$.access') != 'public';
