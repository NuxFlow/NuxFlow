---
"@nuxflow/app": minor
"@nuxflow/cli": minor
"@nuxflow/plugin-canvas": patch
---

Add blog index, full-text search, share buttons, content excerpt/OG image, and fix CLI install on fresh clone.

**Blog & public routes**
- `app/pages/blog/index.vue`: paginated blog post index at `/blog`; fetches `GET /api/public/posts` with `?page` and `?limit` support.
- `server/api/public/posts.get.ts`: new endpoint returning published posts scoped to the current site, with author, excerpt, and featured image.
- `app/pages/search.vue`: full-text search page at `/search`; uses the existing `GET /api/v1/search` endpoint (no auth required); highlights matched terms.
- `server/api/v1/search.get.ts`: FTS5 results now include `slug`, `title`, and `type` so the search page can link directly to content.
- `app/components/PublicShareButtons.vue`: new share buttons component (Web Share API with Twitter/LinkedIn/copy-link fallbacks); rendered on prose content pages and taxonomy archives.
- RSS feed (`server/routes/feed.xml.ts`): include `<content:encoded>` full HTML body and `<author>` per item.
- Sitemap and robots.txt: include blog and taxonomy archive URLs; robots now respects the site's `seoNoindex` setting.

**Content editor**
- Excerpt and OG image fields added to the admin content editor sidebar (`app/pages/admin/content/[id].vue`); excerpt is used in blog listings, RSS, and OG meta; OG image can be picked from the media library.
- `server/api/v1/content/[id].patch.ts`: accept `excerpt` and `ogImage` in the PATCH body.
- `server/api/public/pages/[slug].get.ts`: return `author`, `excerpt`, and `ogImage` in the public page response.
- `app/pages/[...slug].vue` and `app/pages/[taxonomySlug]/[termSlug].vue`: render author byline, featured image, and share buttons; pass `ogImage` to `useSeoMeta`.

**Scheduled tasks**
- `server/tasks/publish-scheduled.ts`: Nitro task wrapper for the scheduled-publish logic (required for the Nitro task system to discover and run it on schedule).

**CLI**
- `packages/cli/build.mjs`: new esbuild script producing a CJS bundle at `bin/nuxflow.cjs` (CJS required because `fs-extra` uses dynamic `require()` internally).
- `bin/nuxflow.cjs` is now committed to git so `pnpm install` can create the `node_modules/.bin/nuxflow` symlink immediately — previously the symlink failed because the built file didn't exist until the `prepare` lifecycle ran (too late in pnpm's install sequence).
- Added `prepare` script so the CLI rebuilds itself automatically on `pnpm install` (keeps `bin/nuxflow.cjs` fresh after source changes).
- Added `files` field (`bin/`, `build.mjs`) so the compiled binary is included when the package is published to npm.
- Scaffold template (`src/utils/scaffold.ts`): `client.ts` template now documents `definition`, `ref`, `onMounted`, full inline types for `Registry`, `VueLike`, and `BlockDefinition`, and the `BLOCK_DEFINITION` pattern for Canvas editor sidebar fields.

**Canvas plugin**
- `CanvasBlockHero`: responsive layout and mobile padding fixes.
- `CanvasBlockFeatures`: icon rendering and grid alignment improvements.
