# @nuxflow/canvas

## 1.0.0-beta.1

### Minor Changes

- dea743b: feat: complete categories, tags, and custom taxonomies
  
  - **Admin → Taxonomies** now edits everything after creation: rename taxonomies and terms, change slugs (old URLs redirect automatically), nest terms under a parent, reorder them, add descriptions, and set an SEO title, description, and share image per term archive. Terms show as a tree with usage counts that link to the matching content. Deletes ask for confirmation, and deleting a term moves its sub-terms up a level.
  - Taxonomies can be limited to specific content types. Categories and Tags now apply to posts by default. A taxonomy can also be hidden from search engines on its own.
  - The editor's **Categories & Tags** card only shows taxonomies for the content type being edited, displays nesting, filters long lists, and has an AI **Suggest** button. Terms now save with the rest of the page, so tagging a new post before its first save works and tag changes follow the normal draft/publish flow.
  - Posts show their categories and tags as links, and include them in structured data. A parent category's archive also lists its sub-categories' posts, with breadcrumbs and sub-category links. Archive pages link each item to its correct URL (translations and the homepage were broken before), show featured images, and have their own RSS feed at `/feed.xml?taxonomy=…&term=…`.
  - New overview page at `/<taxonomy>` (e.g. `/category`) listing every term with published content. New **Posts** Canvas block. `/api/public/posts` accepts `type`, `taxonomy`, and `term` filters.
  - Archive pages refresh right away after retagging, renaming, or deleting a term, instead of staying stale for up to an hour.
  - The default tags taxonomy's URL is now `/tag/…` instead of `/post_tag/…`. Taxonomy slugs that would clash with built-in pages, language prefixes, or existing content are now rejected.
  - MCP: new `list_taxonomies` and `set_content_terms` tools; `get_content` includes terms. The admin content list can be filtered by term.
  - Backup/restore carries the new fields and content-type scoping, maps old `post_tag` backups, drops circular parent links, and no longer strips existing terms when restoring content without taxonomies. The WordPress importer handles non-Latin and percent-encoded category/tag slugs and terms that only appear on posts.

### Patch Changes

- e0684ab: fix: backups include redirects and per-page SEO; mobile layout fixes for Canvas blocks
  
  **Backup, restore, and theme demo content**
  - Backups now include redirects, and each page's robots setting, canonical URL, focus keyword, comment setting, and event details. These were previously lost on restore. Older backups still restore.
  - Restored SEO settings are validated like a save from Admin → SEO, and bad values are skipped rather than failing the restore. They take effect immediately, and cached pages and sitemaps are refreshed after a restore.
  - Theme demo content can ship SEO settings and redirects. Settings only fill in values a site doesn't already have. If a theme turns IndexNow on, the site generates its own key.
  
  **Canvas blocks**
  - Fixed the Features and Testimonial blocks ignoring their **Style** setting. "Card" never added card padding, and Testimonial always showed as a card. The saved value was being swallowed because Vue reserves the name `style`.
  - Features: one card per row on phones, two on tablets, and three or four only on wide screens. Four cards used to sit two-up on phones, squeezing the text past the card edges. New stable theme hooks: `.canvas-features-grid[data-count]` and `.canvas-features-card`.
  - Hero: smaller headline on phones, and full-width stacked buttons.
- 71e9f0f: fix: Canvas pages render on the server again
  
  Every Canvas block was missing from the server-rendered HTML: pages arrived empty and their content only appeared once the browser had loaded and run the JavaScript. Search engines and AI crawlers that don't run JavaScript saw no content at all, and visitors saw the page fill in a moment after loading. Blocks now render on the server as intended.
