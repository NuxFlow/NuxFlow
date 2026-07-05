CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  content_item_id UNINDEXED,
  site_id UNINDEXED,
  title,
  body,
  tokenize = 'porter ascii'
);
--> statement-breakpoint
INSERT INTO search_index (content_item_id, site_id, title, body)
SELECT id, site_id, title, COALESCE(excerpt, seo_description, '')
FROM content_items
WHERE status = 'published' AND visibility = 'public';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON content_items
WHEN NEW.status = 'published' AND NEW.visibility = 'public'
BEGIN
  INSERT INTO search_index (content_item_id, site_id, title, body)
  VALUES (NEW.id, NEW.site_id, NEW.title, COALESCE(NEW.excerpt, NEW.seo_description, ''));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON content_items
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
