-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  content_item_id UNINDEXED,
  site_id UNINDEXED,
  title,
  body,
  tokenize = 'porter ascii'
);

-- Trigger: insert/update content item → sync search index
CREATE TRIGGER IF NOT EXISTS search_index_insert
AFTER INSERT ON content_items
WHEN NEW.status = 'published'
BEGIN
  INSERT INTO search_index(content_item_id, site_id, title, body)
  VALUES (NEW.id, NEW.site_id, NEW.title, COALESCE(NEW.excerpt, ''));
END;

CREATE TRIGGER IF NOT EXISTS search_index_update
AFTER UPDATE ON content_items
BEGIN
  DELETE FROM search_index WHERE content_item_id = OLD.id;
  INSERT INTO search_index(content_item_id, site_id, title, body)
  SELECT NEW.id, NEW.site_id, NEW.title, COALESCE(NEW.excerpt, '')
  WHERE NEW.status = 'published';
END;

CREATE TRIGGER IF NOT EXISTS search_index_delete
AFTER DELETE ON content_items
BEGIN
  DELETE FROM search_index WHERE content_item_id = OLD.id;
END;
