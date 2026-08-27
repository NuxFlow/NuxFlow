---
"@nuxflow/app": patch
"@nuxflow/canvas": patch
"@nuxflow/db": patch
---

refactor: standardize server API error/validation helpers, add missing audit logs, and remove dead code

Server API routes now consistently use the existing `response.ts` helpers (`notFound`, `forbidden`, `conflict`, etc.) instead of hand-rolled `createError()` calls, and the existing `parseBody`/`parseQuery` Zod helpers instead of `readValidatedBody(event, schema.parse)` — the latter previously surfaced bad input as an unhandled 500 instead of a clean 422. Thirteen mutation routes (taxonomies, comments, API keys, redirects, menus, media folders, memberships) that were silently skipping the audit log now write one, matching their sibling routes.

Extracted repeated Drizzle query patterns into shared helpers: `getContentItemOrThrow`/`getContentTypeBySlugOrThrow` in `server/utils/content-queries.ts`, `getUserSiteRole` in `permissions.ts`, and `parsePagination` in `server/utils/pagination.ts` — the last of which also fixes a real bug where `forms/[id]/submissions.get.ts` was missing the `page >= 1` guard the other paginated endpoints had, producing a negative DB offset on `page=0` or negative. `contact/submit.post.ts` now reads its notification email through `resolveSetting()` instead of a raw query that bypassed the settings cache and decryption path.

Also removed dead code found during the audit: an unused Pinia `useContentStore`, an orphaned/stale `searchIndexSql` export duplicating the real FTS5 migration, and an unused `canvasManifest` export in `@nuxflow/canvas`. Consolidated the duplicated block-definition fallback chain (`getBlockDefinition() ?? registry.getDefinition()`, which had already drifted between call sites) into one `resolveDefinition()` helper shared by `useCanvas.ts` and `NuxBlocks.vue`, and merged the app's `NuxBlockData` type with `@nuxflow/canvas`'s `CanvasBlockData` instead of maintaining two identical shapes by hand.
