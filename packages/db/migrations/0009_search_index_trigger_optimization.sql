-- search_index_au previously fired its DELETE+INSERT body on EVERY update to a content
-- item, regardless of which columns actually changed. Because content_item_id is
-- UNINDEXED in the FTS5 virtual table (search_index has no B-tree on any column except
-- the inverted full-text index), `DELETE FROM search_index WHERE content_item_id = NEW.id`
-- requires a full scan of the entire index on every single firing — so even an edit that
-- only touched, say, the scheduling time or an SEO field (never indexed) paid the cost of
-- scanning every row in search_index, for every site sharing this database.
--
-- Adding a WHEN clause that only fires the trigger body when a column that actually
-- affects the index (title/excerpt/seo_description/status/visibility) changed cuts the
-- frequency of that scan down to just the edits that could plausibly need a reindex,
-- without changing behavior for any of those relevant edits.
DROP TRIGGER IF EXISTS search_index_au;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON content_items
WHEN NEW.title IS NOT OLD.title
  OR NEW.excerpt IS NOT OLD.excerpt
  OR NEW.seo_description IS NOT OLD.seo_description
  OR NEW.status IS NOT OLD.status
  OR NEW.visibility IS NOT OLD.visibility
BEGIN
  DELETE FROM search_index WHERE content_item_id = NEW.id;
  INSERT INTO search_index (content_item_id, site_id, title, body)
  SELECT NEW.id, NEW.site_id, NEW.title, COALESCE(NEW.excerpt, NEW.seo_description, '')
  WHERE NEW.status = 'published' AND NEW.visibility = 'public';
END;
