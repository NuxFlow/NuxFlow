# @nuxflow/cli

## 2.0.0-beta.1

### Minor Changes

- 560d4eb: Add blog index, full-text search, share buttons, content excerpt/OG image, and fix CLI install on fresh clone.

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

### Patch Changes

- 1859470: feat: Argon2id password hashing, public footer/sidebar, and major dependency upgrades

  **Security — Argon2id password hashing**
  - New `workers/argon2-hasher` Cloudflare Worker: imports `argon2.wasm` statically at build time, exposes `hash` and `verify` via a service binding (`ARGON2`)
  - New `server/utils/pw.ts`: `nuxflowPasswordHasher` adapter that routes to the Argon2 binding in production and falls back to `node:crypto` scrypt in local dev
  - Better Auth `emailAndPassword.password` and setup `complete.post.ts` now use `nuxflowPasswordHasher` instead of `better-auth/crypto`
  - New `ArgonHasherBinding` type in `server/types/cloudflare-bindings.d.ts`
  - New `docs/security.md` documenting algorithm parameters and the rationale for the separate Worker architecture

  **Public layout — footer and sidebar**
  - New `PublicSiteFooter.vue`: footer navigation driven by the `footer` menu slot, hidden when the menu has no items
  - New `PublicSiteSidebar.vue`: sticky right-rail sidebar driven by the `sidebar` menu slot, hidden on mobile and when empty
  - `default.vue` layout updated to a flex-column structure that accommodates both new components

  **Setup improvements**
  - Setup wizard no longer accepts a `domain` field — the site domain is derived from the request `Host` header, eliminating the mismatch between form input and actual hostname
  - Secondary site setup (pre-created by super admin) simplified: lookup is by request host only, fallback by form domain removed
  - Menu item schema: `id` and `type` made optional so newly created items that haven't been persisted yet pass validation

  **Settings cleanup**
  - Google Analytics measurement-ID field removed from Admin → Settings → Integrations (the `integrations.analytics_id` setting key is no longer saved or loaded)

  **Dependency upgrades**
  - Vitest 3 → 4: class mock factories migrated from arrow functions to `function`/`class` syntax; `poolOptions.forks.singleFork` replaced with `maxWorkers: 1`
  - Zod 3 → 4: `z.record()` calls updated to two-arg form `z.record(z.string(), ...)` across all server routes; `schema._type` references replaced with `z.infer<typeof schema>`
  - `@nuxtjs/i18n` 9 → 10: removed `restructureDir: false` (type changed to string-only) and `lazy: true` (now default); `langDir` set to absolute path
  - `ai` 6 → 7, `@ai-sdk/openai/anthropic/google` 3 → 4, `openai` 4 → 6: no API changes required
  - `ulid` 2 → 3: drop-in replacement, no changes required
  - `stripe` 17 → 22: `customer.subscription.*` webhook type assertion updated to `as unknown as` for fields removed from SDK types
  - `@nuxt/test-utils` 3 → 4: no changes required

  **TypeScript / test compatibility fixes (surfaced by upgrades)**
  - `db.values<[string]>()` generic corrected (was `<[string][]>`, which returned the wrong nested type)
  - Non-null assertions added to `allSites[0]` accesses in multi-site middleware (`noUncheckedIndexedAccess`)
  - `H3Event` type assertions updated to use `as unknown as` intermediate where needed
  - `tests/helpers/globals.ts` annotated `@ts-nocheck` for globalThis property augmentation
  - `seedTier` seed helper: removed `slug` field not present in `membershipTiers` schema
  - `pages-access.test.ts`: `settings` values passed as objects, not `JSON.stringify` strings
  - Video token handler checks `response.ok` before calling `response.json()` to avoid TypeError on error bodies

## 2.0.0-beta.0

## 1.0.0
