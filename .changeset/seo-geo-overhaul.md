---
"@nuxflow/app": minor
"@nuxflow/db": minor
---

feat: SEO, GEO, and AI-crawler overhaul

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
