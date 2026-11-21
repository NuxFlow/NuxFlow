---
"@nuxflow/app": minor
"@nuxflow/canvas": patch
---

fix: backups include redirects and per-page SEO; mobile layout fixes for Canvas blocks

**Backup, restore, and theme demo content**
- Backups now include redirects, and each page's robots setting, canonical URL, focus keyword, comment setting, and event details. These were previously lost on restore. Older backups still restore.
- Restored SEO settings are validated like a save from Admin → SEO, and bad values are skipped rather than failing the restore. They take effect immediately, and cached pages and sitemaps are refreshed after a restore.
- Theme demo content can ship SEO settings and redirects. Settings only fill in values a site doesn't already have. If a theme turns IndexNow on, the site generates its own key.

**Canvas blocks**
- Fixed the Features and Testimonial blocks ignoring their **Style** setting. "Card" never added card padding, and Testimonial always showed as a card. The saved value was being swallowed because Vue reserves the name `style`.
- Features: one card per row on phones, two on tablets, and three or four only on wide screens. Four cards used to sit two-up on phones, squeezing the text past the card edges. New stable theme hooks: `.canvas-features-grid[data-count]` and `.canvas-features-card`.
- Hero: smaller headline on phones, and full-width stacked buttons.
