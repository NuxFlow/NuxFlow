-- Hand-written: rebuilds the FTS5 search index with the unicode61 tokenizer.
--
-- 0001 used `porter ascii`, which only folds ASCII case and keeps accented letters as-is,
-- so "Crème" never matched "crème" and accent-free queries never matched accented words.
-- unicode61 with remove_diacritics 2 folds case and accents for every script.
--
-- Every statement is safe to re-run (the runner applies them one at a time, with no
-- transaction). The triggers from 0001 refer to search_index by name and keep working.
-- A virtual table is the target of no foreign key, so none of the rebuild hazards in
-- CLAUDE.md apply here.
DROP TABLE IF EXISTS search_index;
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  content_item_id UNINDEXED,
  site_id UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
DELETE FROM search_index;
--> statement-breakpoint
INSERT INTO search_index (content_item_id, site_id, title, body)
SELECT id, site_id, title, COALESCE(excerpt, seo_description, '')
FROM content_items
WHERE status = 'published' AND visibility = 'public';
