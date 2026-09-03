---
"@nuxflow/app": minor
---

feat: full-page HTML edge cache for public pages

The public JSON data layer (`withEdgeCache`) was already cached via Cloudflare's Cache API, but the actual rendered HTML page was not — every visit re-ran the full Vue SSR render even on a cache hit for the data behind it. This adds a second cache layer that skips rendering entirely on a hit.

- New `server/middleware/07.page-cache.ts` (read side) checks the Cache API before any routing/rendering happens; a hit replays the saved HTML and headers directly.
- New `server/plugins/page-cache.ts` (write side) hooks Nitro's `render:response` to save the final rendered HTML after a cache miss.
- New `server/utils/page-cache.ts` is the single source of truth both sides share for what's eligible to cache. Only anonymous, default-locale, non-admin/API/asset `GET` requests qualify — determined by an explicit cookie *allowlist* (only the `@nuxtjs/i18n` language-redirect cookie, and only at the site's default locale) rather than a denylist, so a future cookie from some other feature or plugin defaults to "don't cache" rather than risking a personalized response being served to someone else. (Verified against the live site: every first-time visitor picks up that language cookie automatically, so gating on "zero cookies" alone would have made the cache almost never fire past a visitor's first page view.)
- `purgeContentCache` (`edge-cache.ts`) now also purges the rendered page path(s) for a content change, not just the JSON path — including mapping the homepage content item's slug (`home`) to its real URL (`/`).
- New `purgeAllPublicPages()` handles the cases where a single change affects *every* cached page (a full page's HTML now has the site's shared chrome baked in, unlike the JSON layer) — wired into site/appearance settings changes, header/footer menu edits, and theme activation/CSS/customizer/reset. Runs in the background via `waitUntil` so it never slows down the admin action that triggered it.
- Renumbered `server/middleware/redirects.ts` → `05.redirects.ts` and `theme-preview.ts` → `06.theme-preview.ts` so Nitro's filename-order middleware loading puts them (correctly) before the new cache check — an unnumbered file sorts after any digit-prefixed one, which would have let a newly-added redirect get shadowed by a stale cached page.

Verified locally end-to-end via `wrangler dev`: confirmed MISS → HIT on a repeat request, confirmed `/admin` and `/api` routes are never touched by this cache, and confirmed a request carrying an unrecognized cookie neither reads from nor writes to it.
