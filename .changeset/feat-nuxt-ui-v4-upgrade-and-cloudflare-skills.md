---
"@nuxflow/app": minor
"@nuxflow/canvas": minor
---

feat: upgrade @nuxt/ui v3 to v4, add Cloudflare agent skills, consolidate server audit/pagination helpers

**Nuxt UI v3.3.7 → v4.11.0**
- `@nuxt/ui` bumped in `apps/nuxflow/package.json` and `packages/canvas/package.json` (dependency, devDependency, and peerDependency)
- Nuxt UI v4 unifies the former paid `@nuxt/ui-pro` into the single free `@nuxt/ui` package under MIT — confirmed via the package's `LICENSE.md` and `ui.nuxt.com`'s own FAQ, so this closes out the licensing review from the earlier Pro→free migration for good (no separate Pro tier can be reintroduced by accident)
- The Headless UI → Reka UI / Tailwind Variants rewrite happened in the v2→v3 jump, which this project had already adopted, so v4's actual breaking changes (Pro package rename, `UButtonGroup`→`UFieldGroup`, `UPageMarquee`→`UMarquee`, `UPageAccordion` removal, `.nullify`→`.nullable` modifier, `UForm` nested-form changes) had zero footprint here — verified by a full usage audit before upgrading
- Verified with lint, typecheck, the full unit (233) and integration (304) suites, and a live `wrangler dev` + Playwright E2E pass covering login, the admin dashboard, content list, and media library

**Server API cleanup**
- New `batchWithAudit()` helper in `server/utils/audit.ts` replaces the `db.batch(auditInsert ? [...writes, auditInsert] : writes)` ternary that was duplicated across 44 mutation routes
- New `countRows()` helper in `packages/db/src/queries/paginate.ts` replaces the repeated `db.select({ total: sql\`count(*)\` })` one-liner across paginated list routes
- Fixed `forms/[formIdentifier]/submissions.get.ts`, the one paginated list route that wasn't using the shared `paginate()` helper and so never returned a `total` count

**E2E test fix**
- `loginAsAdmin()` test helpers (`auth-flow.spec.ts`, `membership.spec.ts`, `admin-content.spec.ts`) used a loose `getByRole('button', { name: /sign in/i })` locator that ambiguously matched both "Sign in" and "Sign in with Passkey" — fixed to an exact match

**Cloudflare agent skills**
- Added `cloudflare`, `wrangler`, `workers-best-practices`, `cloudflare-email-service`, `web-perf`, and `turnstile-spin` to the vendored `.claude/skills`/`.agent/skills` (mirrored, project had zero Cloudflare-specific skill coverage before this)
