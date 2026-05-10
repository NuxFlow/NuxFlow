# Contributing to NuxFlow

Thank you for your interest in contributing. This guide covers everything from reporting bugs to submitting pull requests, as well as how to build plugins and themes for the ecosystem.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Branch & Commit Conventions](#branch--commit-conventions)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Writing Tests](#writing-tests)
- [Building a Plugin](#building-a-plugin)
- [Building a Theme](#building-a-theme)
- [Architecture Notes](#architecture-notes)

---

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Please report unacceptable behaviour to [conduct@nuxflow.io](mailto:conduct@nuxflow.io).

---

## Ways to Contribute

| Type | How |
|---|---|
| Bug report | Open a [bug report issue](.github/ISSUE_TEMPLATE/bug_report.md) |
| Feature request | Open a [feature request issue](.github/ISSUE_TEMPLATE/feature_request.md) |
| Fix a bug | Fork → branch → PR |
| Add a feature | Discuss in an issue first, then PR |
| Documentation | PRs to `README.md`, `CONTRIBUTING.md`, or `specs/` |
| Plugin submission | PR adding your plugin to the bundled list or registry |
| Theme submission | PR adding your theme to the registry |
| Translation | PRs to `apps/nuxflow/app/locales/` |

---

## Development Setup

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| pnpm | 9+ |
| Turso CLI | latest |
| Git | any |

### Local setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/nuxflow.git
cd nuxflow

# Install all workspace dependencies
pnpm install

# Copy environment template
cp apps/nuxflow/.env.example apps/nuxflow/.env
# Edit .env — the file:// SQLite URL works for local dev without Turso

# Run migrations
pnpm --filter @nuxflow/db migrate

# Start dev server
pnpm dev
```

Visit `http://localhost:3000/setup` to complete onboarding.

### Useful commands

```bash
pnpm test           # unit tests (all packages)
pnpm test:watch     # unit tests in watch mode
pnpm test:e2e       # Playwright e2e (requires running dev server)
pnpm typecheck      # TypeScript across all packages
pnpm lint           # ESLint
pnpm build          # production build
```

---

## Branch & Commit Conventions

### Branches

```
feat/short-description      # new feature
fix/short-description       # bug fix
docs/short-description      # documentation only
chore/short-description     # tooling, dependencies, config
refactor/short-description  # refactor with no behaviour change
test/short-description      # tests only
```

### Commit messages

This project enforces [Conventional Commits](https://www.conventionalcommits.org) via `commitlint`.

```
feat: add webhook retry backoff
fix: correct S3 signature generation for non-standard regions
docs: update plugin authoring guide
chore: bump drizzle-orm to 0.46
refactor: extract auth token validation into shared util
test: add form submission integration tests
```

Breaking changes use a `!` suffix or a `BREAKING CHANGE:` footer:

```
feat!: rename TURSO_URL env var to NUXT_TURSO_URL
```

---

## Submitting a Pull Request

1. **Open an issue first** for any change larger than a typo or a trivial bug fix. Discuss the approach before writing code.

2. **Fork and branch** from `main`.

3. **Write tests** for all new behaviour (see [Writing Tests](#writing-tests)).

4. **Check types and lint** before pushing:
   ```bash
   pnpm typecheck
   pnpm lint
   ```

5. **Keep PRs focused** — one feature or fix per PR. Refactors belong in a separate PR.

6. **Fill in the PR template** completely.

7. Maintainers review within ~3 business days. Address review comments with new commits (do not force-push a reviewed branch).

---

## Writing Tests

### Unit tests (Vitest)

Unit test files live next to their source files and are named `*.test.ts`.

```bash
pnpm test              # run all
pnpm test:watch        # watch mode
pnpm --filter @nuxflow/db test   # single package
```

### Integration / API tests

Use `@nuxt/test-utils` for Nitro handler tests. Mount the Nitro app, hit endpoints, and assert responses.

```ts
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('content API', async () => {
  await setup({ rootDir: '../../apps/nuxflow' })

  it('returns 401 without auth', async () => {
    const res = await $fetch('/api/v1/content', { method: 'GET' })
    expect(res.status).toBe(401)
  })
})
```

### E2E tests (Playwright)

E2E tests live in `tests/e2e/` and require the dev server to be running:

```bash
pnpm dev &
pnpm test:e2e
```

---

## Building a Plugin

### Scaffold

```bash
npx nuxflow create-plugin my-plugin
cd packages/plugins/my-plugin
pnpm install
```

### Manifest (`nuxflow.plugin.ts`)

```ts
import { defineNuxFlowPlugin } from '@nuxflow/plugin-sdk'

export default defineNuxFlowPlugin({
  name: 'My Plugin',
  version: '1.0.0',
  description: 'What this plugin does.',
  permissions: ['read:content', 'send:email'],
  adminMenuItems: [
    {
      label: 'My Plugin',
      to: '/admin/my-plugin',
      icon: 'i-lucide-puzzle',
    },
  ],
})
```

### Structure

```
packages/plugins/my-plugin/
├── nuxflow.plugin.ts       # Plugin manifest (required)
├── nuxt.config.ts          # Nuxt module entry point
├── server/
│   └── api/                # API routes (prefixed automatically)
├── app/
│   └── pages/admin/        # Admin pages
├── components/             # Vue components
└── package.json
```

### Rules

- **No `node:*` imports** — the plugin runs in Cloudflare Workers. Use Web Crypto API (`crypto.subtle`) instead of `node:crypto`, and `fetch()` instead of `node:http`.
- **No dynamic `require()`** — use static `import` only. Nitro bundles statically.
- **No in-memory state** — Cloudflare Worker isolates do not share memory between requests. Use the database.
- **Declare all permissions** — users approve them before activation.
- **Catch your errors** — the plugin loader wraps plugin setup in a try/catch, but individual route handlers must handle their own errors.

---

## Building a Theme

### Scaffold

```bash
npx nuxflow create-theme my-theme
cd themes/my-theme
pnpm install
```

### Structure

```
themes/my-theme/
├── nuxt.config.ts              # Nuxt layer config (required)
├── components/
│   └── blocks/                 # One component per block type
│       ├── Paragraph.vue
│       ├── Heading.vue
│       ├── Image.vue
│       └── ...
├── layouts/
│   └── default.vue             # Public site root layout
├── pages/                      # Theme-specific page overrides
├── assets/                     # CSS, fonts, images
└── package.json
```

### Block component contract

Each block component receives a `block` prop:

```ts
interface Block {
  type: string
  attributes: Record<string, unknown>
}
```

Example `Paragraph.vue`:

```vue
<script setup lang="ts">
defineProps<{ block: { attributes: { content: string } } }>()
</script>

<template>
  <p class="my-4 leading-relaxed" v-html="block.attributes.content" />
</template>
```

### Publish

Publish your theme as an npm package and open a PR adding it to the NuxFlow theme registry (documented in `specs/`).

---

## Architecture Notes

### Cloudflare Workers constraints

All server code (API handlers, middleware, plugins, utilities) runs in the Cloudflare Workers runtime. Key restrictions:

| Not allowed | Use instead |
|---|---|
| `node:crypto` | `crypto.subtle` (Web Crypto API) |
| `node:fs` | `fetch()` / Turso client |
| `require()` dynamic | Static `import` |
| In-memory Map/state | Turso DB (shared across isolates) |
| Long-running processes | Cron via Cloudflare scheduled workers |

### Database

All queries must be scoped to `event.context.site.id`. Do not write queries without a `siteId` filter — cross-site data leakage is a critical security issue.

### API conventions

- Use `parseBody(event, schema)` (Zod) for all request bodies.
- Use `requireRole(event, 'admin')` or `requireAuth(event)` at the top of every protected handler.
- Return errors with the `response.ts` helpers (`notFound()`, `unauthorized()`, `validationError()`).
- All mutations should call `writeAuditLog(event, userId, { action, resource, resourceId, before, after })`.

### Multi-site isolation

Every database table that stores site-specific data has a `site_id` column. The `server/middleware/site.ts` middleware resolves the current site from the `Host` header and attaches it to `event.context.site`. All handlers use `event.context.site.id` — never hardcode a site ID.

---

## Questions?

Open a [Discussion](https://github.com/nuxflow/nuxflow/discussions) for questions, ideas, or general feedback.
