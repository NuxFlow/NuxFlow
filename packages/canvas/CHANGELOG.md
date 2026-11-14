# @nuxflow/canvas

## 1.0.0-beta.1

### Minor Changes

- 2b9cd96: Finish the calendar and events, and add RSVPs.
  
  - Fix scheduling: the editor's date was refused on save, "Schedule" with no date published straight away, and due posts waited until the next UTC midnight
  - Fix a published item reverting to draft on its next autosave
  - Fix event times moving on every save outside UTC, and all-day events landing on the wrong day
  - Events and publish dates are entered and shown in the site's time zone
  - Admin calendar: add from a day, drag to move, unscheduled drafts, filters, agenda view, week start, multi-day events
  - Events and Posts in the admin menu; event dates required to publish and validated everywhere, MCP included
  - Event pages show when and where, with Add to calendar; translations keep event details
  - Calendar block: pages through months, links to events, past events, Subscribe link
  - Valid, complete calendar feeds (`/events.ics`, one file per event)
  - RSVPs with email confirmation, capacity, waitlist with automatic promotion, attendee list, CSV export
- 6e8a8cd: feat: the Canvas editor shows a page the way it looks live
  
  The editor now draws the page inside a frame with the site's own theme CSS, colours, fonts, custom head stylesheets and light or dark mode, so a themed starter like Hollis Reed no longer looks unstyled while you edit it. New toolbar buttons show the page at desktop, tablet or phone width, or fitted to the editor. Saving custom head or body HTML now takes effect on public pages straight away instead of after up to a minute.
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
- b93f227: feat: search and filter the block picker
  
  The Add a block window now opens with a search box (names and descriptions; Enter adds the top match), category buttons with counts, and wider tiles that show each block's description. It also fixes tiles that were unreadable: Video and Video gallery in light mode, and every other tile in dark mode.
- ae14665: Pre-release code health pass.
  
  - Search works for every language: queries in non-Latin scripts no longer fail, and case and accents are ignored (the search index now folds them for every script). Search results and RSS/Atom items link to each page's public address, so translations open at `/{language}/{page}`.
  - The Atom feed blocks `javascript:` links, and both feeds render posts with the same renderer as the site.
  - Dates in the admin and on public pages show correctly in Safari and in the viewer's own timezone.
  - A signed-in visitor who sends the contact form now gets the "message received" notification when that push event is switched on.
  - The MCP server uses the stateless Streamable HTTP transport (the old SSE transport is gone); see docs/mcp.md for client setup.
  - Admin error messages now include the server's reason in more places.
  - Removed dead code and unused dependencies (including Pinia), and replaced duplicated helpers with one shared copy each.
- 8d7f663: fix: readable block settings in dark mode, and sign-in alerts name the site
  
  In dark mode the text in a block's rich-text box (for example a Text block's content) was dark on a dark background and couldn't be seen; the settings panel's other fields now follow dark mode too. The "new sign-in to your account" email now says which site you signed in to use, instead of only showing the platform's name.
- 71e9f0f: fix: Canvas pages render on the server again
  
  Every Canvas block was missing from the server-rendered HTML: pages arrived empty and their content only appeared once the browser had loaded and run the JavaScript. Search engines and AI crawlers that don't run JavaScript saw no content at all, and visitors saw the page fill in a moment after loading. Blocks now render on the server as intended.
