-- Hand-written: Drizzle's schema DSL can't express FTS5 virtual tables or triggers.
--
-- Full-text search index behind GET /api/v1/search. Kept in sync entirely by the
-- triggers below, so every write path (API, setup seeding, demo reset, restore, import)
-- stays indexed with no application code. Only published, public items are indexed; the
-- body is the excerpt, falling back to the SEO description — not the full content.
-- content_item_id/site_id are UNINDEXED: stored for lookups/filtering, never tokenized.
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  content_item_id UNINDEXED,
  site_id UNINDEXED,
  title,
  body,
  tokenize = 'porter ascii'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON content_items
WHEN NEW.status = 'published' AND NEW.visibility = 'public'
BEGIN
  INSERT INTO search_index (content_item_id, site_id, title, body)
  VALUES (NEW.id, NEW.site_id, NEW.title, COALESCE(NEW.excerpt, NEW.seo_description, ''));
END;
--> statement-breakpoint
-- Fires only when an indexed or index-gating column actually changed. search_index has
-- no B-tree on content_item_id (it's UNINDEXED in the FTS5 table), so the DELETE below
-- is a full scan of the index — the editor autosaves every 10s, and without this WHEN
-- clause every autosave (content-only edits included) paid that scan.
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
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON content_items
BEGIN
  DELETE FROM search_index WHERE content_item_id = OLD.id;
END;
