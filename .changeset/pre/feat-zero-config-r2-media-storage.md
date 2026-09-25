---
"@nuxflow/app": minor
---

feat: zero-config R2 media storage, one-click move of database-stored media, and clearer storage status

**R2 works with just the bucket binding**
- With the `MEDIA_BUCKET` R2 binding present, uploads now go to R2 even when no public bucket URL is configured — files are served by the Worker itself at `/_nuxflow/media/<key>` (tenant-isolated, ETag/304, byte ranges, year-long cache for upload keys, forced `CSP: sandbox` + `nosniff`). Previously, a bound bucket without a public URL silently fell back to storing base64 in D1. A public R2 URL remains an optional performance setting.
- Binding-only R2 is checked after explicitly configured S3/Bunny.net, so adding the binding never moves a site off a provider it chose on purpose.
- `wrangler.toml.example` now enables the `[[r2_buckets]]` binding by default (`wrangler r2 bucket create nuxflow-media` once; `wrangler dev` simulates it locally).
- RSS/Atom feeds, both sitemaps, and og:image/Twitter/JSON-LD always emit absolute media URLs; the image sitemap no longer includes base64 `data:` URIs.

**Move database-stored media to real storage**
- Settings → Media has a new status card and a **Move to …** button that moves media-library files stored in D1 — and images embedded directly in pages/settings — to the active provider, verifying each copy before rewriting every reference (content, drafts, revisions, og images, menus, themes, settings, avatars) and only then dropping the database copy.
- Runs in small, bounded, resumable batches (`GET`/`POST /api/v1/media/migration`, admin-only): rows are rewritten one at a time within a per-request query/time budget, so a file embedded in many large drafts can't exceed the Worker's memory or D1 query limits.

**Clearer storage messaging**
- Super Admin → Database now distinguishes "no media storage connected" from "storage connected, older files still in the database", with a link to move them.
- The setup wizard shows a plain status line for file storage instead of asking anything.
