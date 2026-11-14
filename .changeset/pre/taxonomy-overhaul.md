---
"@nuxflow/app": minor
"@nuxflow/db": minor
"@nuxflow/canvas": minor
---

feat: complete categories, tags, and custom taxonomies

- **Admin → Taxonomies** now edits everything after creation: rename taxonomies and terms, change slugs (old URLs redirect automatically), nest terms under a parent, reorder them, add descriptions, and set an SEO title, description, and share image per term archive. Terms show as a tree with usage counts that link to the matching content. Deletes ask for confirmation, and deleting a term moves its sub-terms up a level.
- Taxonomies can be limited to specific content types. Categories and Tags now apply to posts by default. A taxonomy can also be hidden from search engines on its own.
- The editor's **Categories & Tags** card only shows taxonomies for the content type being edited, displays nesting, filters long lists, and has an AI **Suggest** button. Terms now save with the rest of the page, so tagging a new post before its first save works and tag changes follow the normal draft/publish flow.
- Posts show their categories and tags as links, and include them in structured data. A parent category's archive also lists its sub-categories' posts, with breadcrumbs and sub-category links. Archive pages link each item to its correct URL (translations and the homepage were broken before), show featured images, and have their own RSS feed at `/feed.xml?taxonomy=…&term=…`.
- New overview page at `/<taxonomy>` (e.g. `/category`) listing every term with published content. New **Posts** Canvas block. `/api/public/posts` accepts `type`, `taxonomy`, and `term` filters.
- Archive pages refresh right away after retagging, renaming, or deleting a term, instead of staying stale for up to an hour.
- The default tags taxonomy's URL is now `/tag/…` instead of `/post_tag/…`. Taxonomy slugs that would clash with built-in pages, language prefixes, or existing content are now rejected.
- MCP: new `list_taxonomies` and `set_content_terms` tools; `get_content` includes terms. The admin content list can be filtered by term.
- Backup/restore carries the new fields and content-type scoping, maps old `post_tag` backups, drops circular parent links, and no longer strips existing terms when restoring content without taxonomies. The WordPress importer handles non-Latin and percent-encoded category/tag slugs and terms that only appear on posts.
