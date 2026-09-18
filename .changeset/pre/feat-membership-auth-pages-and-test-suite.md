---
"@nuxflow/app": minor
---

Add membership, auth, and public-facing pages; introduce 3-layer test suite; fix Cloudflare 522 registration timeout.

**New pages:** `/register`, `/forgot-password`, `/reset-password`, `/pricing`, `/account` — all using the `auth` layout with glass-card styling.

**Registration fix:** The `POST /api/public/auth/register` handler previously made a self-referencing HTTP call to Better Auth's sign-up endpoint, which causes a Cloudflare 522 connection-timeout when a Worker tries to fetch itself. The handler now creates the user and credential account directly in the database using `hashPassword` from `better-auth/crypto`, matching the setup wizard's approach. A new `GET /api/public/auth/registration-status` endpoint lets the register page check whether public registration is enabled before showing the form, so users are not presented with a form they cannot submit.

**Content gating:** `GET /api/public/pages/[slug]` now enforces visibility rules (`public`, `members`, `private`, `tier:<id>`) and returns structured 402 payloads with available tier data.

**Test suite:** Added a 3-layer test infrastructure — 10 unit test files (Vitest, pure logic), 5 integration test files (real in-memory SQLite via libSQL), and 3 Playwright E2E specs with a global setup that seeds a test site. New scripts: `test:integration`, `test:all`, `test:e2e`.
