---
"@nuxflow/app": minor
"@nuxflow/plugin-canvas": minor
---

feat: gallery block with lightbox, EXIF extraction, image sitemap, and SEO/GEO improvements

**Canvas — Gallery block & lightbox**
- New `CanvasBlockGallery` block: responsive photo grid with configurable columns (2/3/4), gap, rounded corners, and optional lightbox
- New `NuxLightbox` component: keyboard-navigable (←/→/Esc) and touch-enabled modal image viewer shared by both gallery and single image blocks
- `CanvasBlockImage` gains a "Open lightbox on click" toggle field

**Media**
- EXIF extraction on JPEG/TIFF upload via new zero-dependency `server/utils/exif.ts` (reads IFD0 + ExifIFD from JPEG APP1 segments, stored in `media.metadata.exif`)
- Image sitemap at `/sitemap-images.xml` for Google Image Search indexing

**Blog**
- Grid/list layout toggle on the blog index page with localStorage persistence

**SEO & GEO**
- Theme demo import now includes site settings (SEO, appearance, etc.) — `settings` was missing from the `what` array in both the server schema and the frontend call
- AI Crawlers tab in Admin → SEO shows a persistent warning to check Cloudflare's "Block AI Scrapers and Crawlers" toggle, which overrides `robots.txt` at the network level

**Performance & reliability**
- Migration middleware gains a fast-path boolean flag (`_migrationsDone`) so already-migrated isolates skip all async overhead on subsequent requests
- Scheduled task registration moved to unconditional lists; demo tasks guard themselves at runtime via `isDemo` config rather than at build time via `process.env`
