# @nuxflow/app

## 1.0.0-beta.1

### Minor Changes

- e0684ab: fix: backups include redirects and per-page SEO; mobile layout fixes for Canvas blocks
  
  **Backup, restore, and theme demo content**
  - Backups now include redirects, and each page's robots setting, canonical URL, focus keyword, comment setting, and event details. These were previously lost on restore. Older backups still restore.
  - Restored SEO settings are validated like a save from Admin → SEO, and bad values are skipped rather than failing the restore. They take effect immediately, and cached pages and sitemaps are refreshed after a restore.
  - Theme demo content can ship SEO settings and redirects. Settings only fill in values a site doesn't already have. If a theme turns IndexNow on, the site generates its own key.
  
  **Canvas blocks**
  - Fixed the Features and Testimonial blocks ignoring their **Style** setting. "Card" never added card padding, and Testimonial always showed as a card. The saved value was being swallowed because Vue reserves the name `style`.
  - Features: one card per row on phones, two on tablets, and three or four only on wide screens. Four cards used to sit two-up on phones, squeezing the text past the card edges. New stable theme hooks: `.canvas-features-grid[data-count]` and `.canvas-features-card`.
  - Hero: smaller headline on phones, and full-width stacked buttons.
- 45f9a6d: feat: the CLI deploys with an API key, so it works on multi-site installs
  
  **Breaking for the CLI:** `nuxflow plugin deploy`/`update` and `nuxflow theme deploy`/`update` no longer take `--email` and `--password`. Use an API key instead:
  
  1. In your site's admin, go to **Settings → API keys** and create a key with **Install and remove plugins** and/or **Upload and update themes**.
  2. Set `NUXFLOW_SITE` and `NUXFLOW_API_KEY` (or pass `--site` and `--api-key`).
  
  Signing in with a password only ever worked on single-site installs: with central sign-in, passwords are accepted only on the accounts domain, so the CLI got "not found" on every site domain.
  
  - Two new API key permissions, `manage:plugins` and `manage:themes`. A key with one of them works only while the person who created it is still an admin of that site.
  - The CLI never handles your password, and still refuses to send its key over plain `http://` (except to `localhost`).
- 4553e5c: Gate the remaining shared resources on a hosting platform: Image Transformations become a plan feature (off by default); inbound email gets an "Emails received a month" limit and its R2 copies count towards storage; visitor-triggered AI (listen, spam checks, inbox sorting, smart search, plugin AI) gets its own "Visitor AI credits a month" allowance; smart-search embeddings are counted as AI credits; plugin requests are counted (soft limit) and rate-limited per visitor; and a soft, nightly-measured database-size limit is added.
- 45f9a6d: fix: release-readiness pass — security headers, primary-site protection, pinned scaffolder
  
  **Security**
  - Admin, account, setup, and sign-in pages can no longer be framed by other sites (clickjacking protection). Every response also sends `X-Content-Type-Options: nosniff` and a `Referrer-Policy`.
  - Google and GitHub sign-in tokens are now encrypted in the database.
  - Video upload requests are validated; a malformed Cloudflare Stream ID is rejected.
  - Security reports now go through GitHub's private vulnerability reporting (the old contact address didn't exist).
  
  **Fixes**
  - The primary site can no longer be deleted while other sites exist, from either Settings → Danger Zone or Super Admin → Sites. "Primary" now means the site flagged as primary, not the oldest one.
  - `/api/health` reports the real version.
  - The Themes page no longer describes "bundled themes" installed with a command that doesn't exist, and the image generator no longer claims it needs a DALL-E or Imagen key.
  
  **Changes**
  - `create-nuxflow-app` now downloads the NuxFlow release it was published with, instead of whatever is on `main`. Set `NUXFLOW_TEMPLATE_REF` to scaffold from a branch or commit instead.
  - Old compatibility paths were removed: settings encrypted with the pre-HKDF key, theme CSS stored under the unversioned KV key, `post_tag` in backups, and DALL-E pixel sizes on the image API.
- 21d4347: Remove the S3-compatible and Bunny.net media storage providers. Storage is now Cloudflare-only: R2 (the `MEDIA_BUCKET` binding) or Cloudflare Images.
- a92ee06: feat: SEO, GEO, and AI-crawler overhaul
  
  **Fixes**
  - Translated pages at `/es/page` returned 404. They now load, and each gets one canonical URL plus hreflang alternates.
  - The "Default site title", "Default OG image", and "Default meta description" settings were saved but never used. They now drive the homepage, archives, and fallbacks.
  - Every site showed NuxFlow's own `@nuxflow` X handle and "NuxFlow" site name in its share tags, plus the wrong `og:url` on some pages. The `nuxt-seo-utils` module responsible was removed; per-site values are used instead.
  - The homepage's fallback description was NuxFlow's marketing text on every site.
  - "Block AI crawlers" never actually blocked Google's AI training: `Googlebot-Extended` isn't a real token (it's `Google-Extended`). The crawler list is updated.
  - Hiding the site from search engines now sends `noindex` rather than only blocking crawling, which left URLs in results.
  - The sitemap listed `/home` and `/search`, pages marked noindex, and translations under internal slugs, and used an invalid `lastmod` format.
  - Redirects didn't match URLs that had a query string or trailing slash.
  - robots.txt changes took up to an hour to appear.
  - Duplicate hostnames (the `workers.dev` address, www/apex twins) are now marked `noindex`.
  
  **New**
  - AI crawler mode that blocks AI training but allows AI search and answers, published as a `Content-Signal` in robots.txt and as a header on every page.
  - Crawler activity report showing which search and AI crawlers visit, and what they fetch.
  - Markdown version of every page (`/page.md` or `Accept: text/markdown`), plus `/llms-full.txt`. `llms.txt` is grouped by content type and has an optional introduction.
  - Structured data: BlogPosting, Event, WebPage, FAQPage (from Accordion blocks), and Organization with social profiles.
  - IndexNow notifications on publish, update, rename, and delete.
  - Search engine verification codes, X handle, and social profiles.
  - Hide content types or archives from search engines, and add custom robots.txt rules.
  - Optional 301 from other hostnames to the primary domain.
  - Redirects: edit, 307/308/410, CSV import, and chain flattening. Renaming a published page adds its 301 automatically.
  - SEO audit that lists pages with missing, long, or duplicate titles and descriptions and missing share images.
  - AI suggestions read the page's actual content.
  - The image sitemap lists each page with the images it shows.
  - Editors can open Admin → SEO for Redirects and the Audit.
- 63b0363: feat: "Finish setting up your site" checklist on the admin dashboard
  
  - The dashboard now shows admins a live checklist of the settings every installation should have, since NuxFlow keeps working without them and the gaps aren't obvious. Essential: file storage, email sending, your own domain, a real auth secret, and search basics. Recommended: AI, bot protection, a passkey, a recent backup, and IndexNow.
  - Each item explains what goes wrong without it and links to where it's fixed and to the matching step in the docs. Items tick themselves off once done.
  - It also catches misconfigurations: a failing email provider, a missing email binding, Turnstile with only one of its two keys, a placeholder auth secret, or a site still hidden from search engines.
  - Essential items can't be skipped. The card can be hidden once they're all done, and it comes back if one breaks later.
  - Docs: new After-installation checklist in the installation guide. The Turnstile setup instructions were wrong and are fixed: the secret is `CLOUDFLARE_TURNSTILE_SECRET_KEY` and the site key goes in Settings → Integrations. The cron trigger description is updated.
- dea743b: chore: squash the D1 migration history before the first release
  
  - The migration history is replaced by `0000_initial.sql` (generated from the current schema) and `0001_search_index.sql` (the hand-written full-text search table and triggers). The unused `accounts.expires_at` column is dropped; the schema is otherwise identical.
  - **Breaking for existing databases:** a database created with the old migrations must be recreated (export per-site backups first, then restore them onto the new database). The migration runner tracks applied files by name, so it can't upgrade an old database to the new baseline.
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

- 1cd8036: Admin and account buttons now report results the same way everywhere.
  
  - Every failed action shows what failed ("Couldn't delete theme") with the server's reason underneath, instead of a mix of styles.
  - Buttons in lists (themes, passkeys, comments, subscribers, redirects, domains and more) show their own spinner, so working on one row no longer looks like it affects the others.
  - Passkey and linked-account errors returned by the sign-in service are now reported instead of being missed.
- cfa9830: Generate with AI and Translate work with DeepSeek, and Publish all sets the new homepage.
  
  - Generating pages and translating failed on DeepSeek ("Invalid json schema: invalid type: map, expected a boolean"); the answer formats now suit every provider.
  - A plan or page the AI makes slightly too long is trimmed instead of failing with "The AI's answer wasn't in the expected format". When an answer is still rejected, the Worker log says why.
  - Publish all on a whole-site job makes the planned home page your homepage. Your previous homepage is kept as a draft at /previous-home.
- ae14665: Pre-release code health pass.
  
  - Search works for every language: queries in non-Latin scripts no longer fail, and case and accents are ignored (the search index is rebuilt by migration `0010_search_unicode.sql`). Search results and RSS/Atom items link to each page's public address, so translations open at `/{language}/{page}`.
  - The Atom feed blocks `javascript:` links, and both feeds render posts with the same renderer as the site.
  - Dates in the admin and on public pages show correctly in Safari and in the viewer's own timezone.
  - A signed-in visitor who sends the contact form now gets the "message received" notification when that push event is switched on.
  - The MCP server uses the stateless Streamable HTTP transport (the old SSE transport is gone); see docs/mcp.md for client setup.
  - Admin error messages now include the server's reason in more places.
  - Removed dead code and unused dependencies (including Pinia), and replaced duplicated helpers with one shared copy each.
- 5fb13c7: A proper demo mode for public demo deployments (`NUXT_IS_DEMO = "true"`).
  
  - AI is always off in the demo, whatever bindings or keys the Worker has.
  - The shared demo login is now an admin, not a super admin, so the platform screens aren't reachable.
  - Account changes, API keys, MCP, plugins, the setup wizard, restore/import, video uploads, theme uploads, custom HTML (settings and the HTML block) and credential settings are refused with "This is switched off in the live demo."
  - Uploads are images only, up to 2 MB, and every page is sent with `noindex`.
  - The admin shows a "You're in the live demo" notice.
  - The nightly reset now wipes every table, and a fresh demo database seeds itself without waiting for a visitor.
- 71e9f0f: fix: Canvas pages render on the server again
  
  Every Canvas block was missing from the server-rendered HTML: pages arrived empty and their content only appeared once the browser had loaded and run the JavaScript. Search engines and AI crawlers that don't run JavaScript saw no content at all, and visitors saw the page fill in a moment after loading. Blocks now render on the server as intended.
- 9612524: fix: setting up a second site with central sign-in
  
  - **"Use Existing Admin" now asks for that account's password.** The setup wizard hid the password field in this mode while the server required it, so it always failed with "enter that account's current password".
  - **After setup you choose which account continues.** If the browser was already signed in to the accounts domain as someone else (typically the platform's super admin), that account was silently signed in to the new site. Now only accounts with a role on the site continue automatically; everyone else, super admins included, sees "Continue to … ?" with "Use a different account".
  - **A failed sign-in hand-off shows a "Try again" page** instead of silently starting over, which could loop endlessly on "Signing you in…" with the buttons stuck. The reason is written to the Worker logs.
- Updated dependencies [e0684ab]
- Updated dependencies [ae14665]
- Updated dependencies [71e9f0f]
- Updated dependencies [45f9a6d]
- Updated dependencies [a92ee06]
- Updated dependencies [dea743b]
- Updated dependencies [dea743b]
  - @nuxflow/canvas@1.0.0-beta.1
  - @nuxflow/db@1.0.0-beta.1
