---
"@nuxflow/app": minor
"@nuxflow/db": minor
---

Add editorial calendar and scaffold event fields for future events system.

- New `/admin/calendar` page with month-view grid, colour-coded content chips by status (published/scheduled/draft/review/archived), month navigation, and click-through to the content editor
- New `GET /api/v1/content/calendar` endpoint accepting `from`/`to` date params; returns content items grouped by their publication or scheduled date
- Calendar link added to admin sidebar between Content and Taxonomies
- `content_items` table gains five nullable event scaffold columns (`event_start_at`, `event_end_at`, `event_location`, `event_url`, `event_all_day`) and an index on `(site_id, event_start_at)` for efficient date-range queries (migration 0006)
- Events System section added to roadmap documenting the full planned feature and what groundwork is already in place
