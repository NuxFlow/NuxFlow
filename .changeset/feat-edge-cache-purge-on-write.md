---
"@nuxflow/app": minor
---

feat: purge the edge cache on write instead of relying solely on TTL expiry

`withEdgeCache` (public pages, posts list, taxonomy archives, menus, site metadata, sitemaps, feeds, `llms.txt`) was TTL-only with no invalidation on write — up to an hour of staleness for the page route specifically (`/api/public/pages/:slug`, 3600s), and up to 5 minutes for the others. A content edit updated the database instantly but the public page a visitor saw could lag behind by that full window, which is a real problem for a CMS's core "publish and see it live" workflow — surfaced directly while diagnosing an unrelated styling bug, where a database fix was correct but invisible on the live site for up to an hour.

New `purgeEdgeCache()` / `purgeContentCache()` in `server/utils/edge-cache.ts` delete the relevant cached entries immediately after a successful write, via the same Cloudflare Cache API `withEdgeCache` reads from. Wired into:
- Content create/update/delete — purges the item's own page, the blog index, sitemaps, feeds, `llms.txt`, and any taxonomy archive pages it's tagged under
- Taxonomy term reassignment — purges the item's page and its (new) tag/category archives
- Menu create/update/delete — purges that menu's location (header/footer/sidebar)
- Settings — purges site metadata on any site-level or settings change

The TTL stays in place as a ceiling on staleness for anything the purge logic doesn't cover (e.g. a paginated archive page beyond the first), but the common "I just published/edited this" path is now near-immediate rather than capped at the TTL window.
