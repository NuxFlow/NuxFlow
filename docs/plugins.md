# External Plugin Development Guide

NuxFlow does not use bundled plugins — Canvas, Contact Forms, and Payments/Memberships are all core features compiled directly into the Worker, not plugins you install or remove. The only kind of plugin is a **dynamic plugin**: a self-contained package you build and upload independently, running as an isolated Cloudflare Worker spawned on demand from code stored in KV, so you can install, update, or remove it without ever redeploying your site.

A plugin can add Canvas blocks, serve its own API routes, keep its own data, read published content, create drafts, use the site's AI, notify admins, call outside services you name, and react to events like a post being published or a form being submitted. It does each of these only through a permission the site admin approves. It never gets the database, the site's secrets, or visitors' sessions (see [Permissions](#permissions)).

> **Note:** Payments & Memberships is a core NuxFlow feature, not a plugin. See the [Payments Setup Guide](./payments-setup.md) for configuration instructions.

This guide covers dynamic plugins end to end: creating, building, deploying, and testing them.

---

## Prerequisites

Before you can use dynamic plugins you need:

| Requirement | Why |
|---|---|
| **Cloudflare Workers Paid plan** ($5/month) | The Worker Loaders feature that spawns plugin Workers is a paid-tier capability. The free plan will reject the deploy with error code `10195`. |
| **Wrangler v4** or higher | Wrangler 3 ignores the `[[worker_loaders]]` binding in `wrangler.toml` entirely, so the `LOADER` binding is never registered. |
| **PLUGIN_KV namespace** configured | Plugin code is stored in KV. See [Installation Guide — Dynamic Plugins](./installation.md#dynamic-plugins-kv--worker-loaders) for setup. |
| **NuxFlow CLI** | The `nuxflow` CLI handles scaffolding, building, and deploying plugins. |

### Upgrade the Workers plan

In your Cloudflare dashboard go to **Workers & Pages → Plans** and switch to **Workers Paid**. This is a separate subscription from Cloudflare website plans (Pro/Business/Enterprise) — upgrading your zone plan does not unlock Dynamic Workers.

### Upgrade Wrangler

```bash
# In your NuxFlow monorepo
pnpm add -D wrangler@^4 --filter @nuxflow/app
# Then redeploy
cd apps/nuxflow && npx wrangler deploy
```

After a successful deploy, `wrangler` will list `env.LOADER — Worker Loader` in the bindings summary.

### Install the NuxFlow CLI

```bash
npm install -g @nuxflow/cli
# or
pnpm add -g @nuxflow/cli
```

---

## Quickstart

```bash
# 1. Scaffold a new plugin project
nuxflow plugin create

# 2. Enter the folder and generate your Ed25519 signature keypair (Required!)
cd my-plugin
nuxflow plugin keygen

# 3. Edit src/server.ts (Edge API) and src/client.ts (Canvas Blocks)

# 4. Build the plugin, computing checksums
nuxflow plugin build

# 5. Create an API key in your site's Admin → Settings → API keys, with
#    "Install and remove plugins" (see "Create an API key" below)
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_API_KEY=nf_...

# 6. Deploy (signs the payload locally using your private key)
nuxflow plugin deploy

# 7. Enable it in Admin → Plugins
```

---

## Scaffold a Plugin

Run `nuxflow plugin create` from any directory. The CLI will prompt for a name and optional description, then create a self-contained project folder:

```
my-plugin/
├── nuxflow.plugin.json   # Plugin manifest (id, name, version, description)
├── src/
│   ├── server.ts         # Cloudflare Worker — handles HTTP requests
│   ├── blocks.json       # Block metadata — name, icon, fields, defaultProps
│   └── client.ts         # Renders each block — runs inside a sandboxed iframe
├── package.json
└── tsconfig.json
```

### nuxflow.plugin.json

The manifest is read by `nuxflow plugin build` and `nuxflow plugin deploy`. Keep the `id` short and unique across all plugins on your site. It may use letters, digits, dots, underscores and hyphens (for example `my-plugin` or `com.example.gallery`).

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "What this plugin does",
  "permissions": ["storage", "content:read"],
  "settings": [
    { "key": "api_key", "label": "API key", "type": "secret", "required": true },
    { "key": "greeting", "label": "Greeting", "type": "text", "default": "Hello" }
  ]
}
```

`permissions` lists what your plugin asks to be allowed to do, and `settings` describes a form NuxFlow shows the site admin. Both are optional, and both are covered by your signature, so nobody can add a permission to a plugin you signed. See [Permissions](#permissions) below.

---

## Writing the Server Module

`src/server.ts` exports a default Cloudflare Worker fetch handler. NuxFlow routes all requests matching `/_nuxflow/ext/{pluginId}/*` into it, with the prefix already stripped.

```typescript
// src/server.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/status') {
      return Response.json({ status: 'ok', plugin: 'my-plugin' })
    }

    if (request.method === 'GET' && url.pathname === '/greet') {
      const name = url.searchParams.get('name') || 'World'
      return Response.json({ message: `Hello, ${name}!` })
    }

    return new Response('Not found', { status: 404 })
  },
}
```

Once deployed and activated, these endpoints are live at:

```
GET https://your-site.workers.dev/_nuxflow/ext/my-plugin/status
GET https://your-site.workers.dev/_nuxflow/ext/my-plugin/greet?name=Alice
```

The server module is compiled as a fully self-contained ESM bundle for Cloudflare Workers (`platform: neutral`, `target: es2022`). Do not import Node.js built-ins; use the [Cloudflare Workers runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/) instead.

---

## Permissions

Your server module runs in its own sandbox. On its own it has no database, no bindings, no cookies and no network: `fetch()` to any address fails. Everything it can do on the site goes through `env.NUXFLOW`, and each method works only if its permission is in `nuxflow.plugin.json` **and** an admin approved it when enabling the plugin. A call without permission throws an error that names the missing permission.

Every call is scoped to the site the plugin is installed on and to your plugin's own id. NuxFlow decides that on its side, so your code can't reach another site's or another plugin's data.

| Permission | What it allows | `env.NUXFLOW` methods |
|---|---|---|
| *(none needed)* | Read the plugin's own settings | `getSettings()` |
| `storage` | Keep the plugin's own data: up to 10 MB, 10,000 keys, 128 KB per value | `storageGet(key)`, `storagePut(key, value, { ttlSeconds? })`, `storageDelete(key)`, `storageList({ prefix?, cursor?, limit? })` |
| `content:read` | Read pages and posts that are published and public, which is what any visitor can see | `listContent({ type?, locale?, limit?, offset? })`, `getContent({ id } \| { slug })` (includes `content` and a `markdown` version) |
| `content:write` | Create **drafts**. It can't publish or change existing content, and remote images in the HTML are dropped | `createDraft({ title, html?, type?, slug?, excerpt?, seoTitle?, seoDescription? })` |
| `ai` | Generate text with the site's AI provider. This counts towards the site's AI usage and plan limit (30 calls a minute) | `generateText({ prompt, system?, maxOutputTokens? })` |
| `notify` | Send the site's admins an in-app notification (20 an hour). Links must be paths on the site | `notifyAdmins({ title, body, url? })` |
| `user:read` | Learn who is signed in when someone uses your plugin's routes | Request headers `x-nuxflow-user-id` and `x-nuxflow-user-role` |
| `network:<host>` | Make HTTPS requests to that host. `*.example.com` covers its subdomains but not `example.com` itself | Plain `fetch()` |
| `hook:<event>` | Be told when something happens (see [Event hooks](#event-hooks)) | Requests to `/__nuxflow/hooks/<event>` |

```typescript
// src/server.ts — the scaffold's src/nuxflow.ts has the full Env type
import type { Env } from './nuxflow'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { greeting } = await env.NUXFLOW.getSettings()
    const visits = Number(await env.NUXFLOW.storageGet('visits') ?? 0) + 1
    await env.NUXFLOW.storagePut('visits', visits)
    return Response.json({ message: `${greeting}!`, visits })
  },
}
```

There is no SDK package to install. `nuxflow plugin create` writes `src/nuxflow.ts` with types for everything above. Keep the parts you use.

**Ask only for what you need.** The admin sees each permission in plain words before approving, and network access and the form/comment hooks are flagged as able to share data. A short list gets approved more readily.

### Network access

With `network:api.example.com`, your plugin's `fetch()` calls go through a NuxFlow gateway that allows only:

- `https://` to an approved host on the default port, with no credentials in the URL;
- never the site's own address or the central sign-in address.

Anything else returns a `403` response with an `x-nuxflow-egress: blocked` header and a message saying why. Redirects are handed back to your code rather than followed, and if you follow one, the next request is checked the same way. Raw TCP (`connect()`) is not available.

### Signed-in users (`user:read`)

When a signed-in person calls one of your plugin's routes, NuxFlow adds `x-nuxflow-user-id` and `x-nuxflow-user-role` (their role on this site, if they have one) to the request. NuxFlow sets these itself and removes any copy a visitor sends, so you can trust them. Your plugin never receives the person's cookies, session or password.

The headers are left out for anonymous visitors, for requests from inside a sandboxed block iframe (those are always anonymous), and for a cross-site `POST`/`PUT`/`PATCH`/`DELETE`, so another website can't act through a visitor's browser. Responses to identified requests are sent with `Cache-Control: private, no-store`.

### Event hooks

Add `hook:<event>` to your permissions to be told when something happens. NuxFlow sends a `POST` to `/__nuxflow/hooks/<event>` on your plugin with this body:

```json
{ "event": "content.published", "occurredAt": "2026-10-19T06:42:59.325Z", "data": { "...": "..." } }
```

| Event | When | `data` |
|---|---|---|
| `content.published` | A page or post becomes published and public (including scheduled publishing) | `id`, `type`, `title`, `slug`, `path`, `locale`, `publishedAt` |
| `content.updated` | A published, public item is changed | same as above |
| `content.unpublished` | A public item is unpublished, archived, made members-only or deleted | same as above, plus `deleted: true` when deleted |
| `form.submitted` | A form (including the contact form) is submitted and passes the spam check | `submissionId`, `formId`, `formSlug`, `formName`, `data` (what the visitor typed) |
| `comment.created` | A comment that isn't spam is posted on a public page | `commentId`, `itemId`, `parentId`, `status`, `body`, `authorName`, `isGuest` |

Members-only and draft content never produce hooks. Visitors can't reach `/__nuxflow/…` paths: NuxFlow answers `404` there, so only NuxFlow can deliver a hook. Hooks are sent in the background after the triggering action completes. A plugin that is slow (15-second limit) or returns an error doesn't affect the save or submission, and a failed delivery is logged but not retried.

```typescript
if (request.method === 'POST' && url.pathname === '/__nuxflow/hooks/form.submitted') {
  const { data } = await request.json() as { data: { formSlug: string, data: Record<string, unknown> } }
  // e.g. forward to a CRM you have a network: permission for
  return new Response(null, { status: 204 })
}
```

### Settings

Each entry in `settings` becomes a field in **Admin → Plugins → ⚙ Settings**:

| Field | Meaning |
|---|---|
| `key` | Lower-case letters, digits and `_` (starting with a letter) |
| `label` | What the admin sees |
| `type` | `text`, `textarea`, `secret`, `toggle`, `number`, `select` or `url` |
| `description`, `required`, `default` | Optional. A `secret` can't have a default |
| `options` | For `select`: `[{ "label": "Fast", "value": "fast" }]` |

`secret` values are stored encrypted. Admins never see them again after saving, and only your plugin can read them (via `getSettings()`). They are left out of backups.

### Limits

Each request to your plugin can use 50 ms of its own CPU time and make 50 calls (to `env.NUXFLOW` or `fetch()` combined). Waiting for a call to come back doesn't count as CPU time.

---

## Client bundles run sandboxed

Before writing any client-side code, it matters how it actually runs: `src/client.ts` never executes in the main NuxFlow app, in the admin dashboard, or anywhere with access to a real user's session. Every dynamic-plugin block instance renders inside its own `<iframe sandbox="allow-scripts">`, with `allow-same-origin` deliberately omitted. That gives the iframe an **opaque origin** — no cookies, no `localStorage`, and any `fetch()` it makes (including to the plugin's own `src/server.ts` endpoints) is a credential-less, cross-origin request, even though it's hitting the same domain. Ed25519 signing and SHA-256 checksums prove your code hasn't been tampered with in transit; the sandbox is what limits what it can do once it runs. This applies everywhere a block renders, including the admin Canvas editor's live preview — not just public pages.

The only channel between your block and the page it's embedded in is `postMessage`: the current field values come in as props, and NuxFlow reads back the rendered height to auto-size the iframe. There's no way to reach outside the frame beyond that.

## Block Metadata (`src/blocks.json`)

Because the block picker has to list your blocks — name, icon, category — before any instance of one exists on a page, that metadata can't live inside the sandboxed `src/client.ts`; there's no iframe to ask yet at that point. It's declared instead as plain JSON that NuxFlow reads directly, never executed:

```json
// src/blocks.json
[
  {
    "id": "my-plugin/banner",
    "name": "My Banner",
    "icon": "i-lucide-megaphone",
    "category": "cta",
    "fields": [
      { "key": "headline", "label": "Headline", "type": "text", "default": "Hello!" },
      { "key": "bgColor", "label": "Background colour", "type": "color", "default": "#4f46e5" }
    ],
    "defaultProps": { "headline": "Hello!", "bgColor": "#4f46e5" }
  }
]
```

The block ID format is `{pluginId}/{blockName}`. The `icon` accepts any [Iconify](https://icon-sets.iconify.design/) icon string (e.g. `i-lucide-box`). `fields` uses the same shape documented in `packages/canvas/src/types.ts`'s `FieldSchema` (`type` is one of `text`, `textarea`, `richtext`, `number`, `color`, `select`, `toggle`, `image`, `images`, `url`, `spacing`).

## Writing the Client Bundle (`src/client.ts`)

`src/client.ts` exports a `renderBlock(blockId, vue)` function. NuxFlow calls it once per rendered block instance, inside the sandbox iframe, and expects back the Vue component for that block id (or `null` if this plugin doesn't recognise it).

Vue is passed in as an argument — do not `import` it as a bare specifier, as the bundle must not include a second copy of Vue.

```typescript
// src/client.ts
export function renderBlock(
  blockId: string,
  { defineComponent, h }: {
    defineComponent: (opts: object) => unknown
    h: (tag: string | object, props?: object | null, children?: unknown) => unknown
  },
) {
  if (blockId !== 'my-plugin/banner') return null

  return defineComponent({
    props: {
      headline: { type: String, default: 'Hello!' },
      bgColor: { type: String, default: '#4f46e5' },
    },
    setup(props: Record<string, string>) {
      return () =>
        h('section', {
          style: { backgroundColor: props.bgColor, padding: '48px', textAlign: 'center' }
        }, [
          h('h2', { style: { color: '#fff', fontSize: '2rem' } }, props.headline),
        ])
    },
  })
}
```

The client bundle is compiled for the browser (`platform: browser`, `target: es2020`, minified). `server.ts`, `blocks.json`, and `client.ts` are all optional — you can have a server-only plugin (API endpoints with no Canvas blocks), or ship `blocks.json` + `client.ts` with no server module at all.

### Structural theming: registering a header or footer

CSS themes (see [Themes & Visual Customizer](../README.md#themes--visual-customizer)) can restyle the built-in site header/footer, but can't replace their markup or behavior — CSS-only themes deliberately can't ship arbitrary code, for the same sandboxing reasons dynamic plugin blocks always render inside an iframe. If a theme needs a structurally different header or footer (not just a different look), ship it as a plugin block the exact same way any other block is declared — an entry in `blocks.json` plus a matching case in `renderBlock()` — there's no separate API. The admin then designates it under **Admin → Themes → Layout regions**, which renders it in place of `PublicSiteHeader`/`PublicSiteFooter` on every public page (`app/layouts/default.vue`).

A block intended for this should be self-contained (fetch whatever data it needs itself, e.g. from `GET /api/public/site`) since it's rendered with no props — it isn't a child of any specific page's content tree the way a normal Canvas block is.

---

## Building

Run from inside the plugin directory:

```bash
nuxflow plugin build
```

This compiles both source files with esbuild and writes the result to `dist/plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "...",
  "serverModule": "<base64-encoded ESM>",
  "clientBundle": "<base64-encoded ESM>"
}
```

The `dist/` folder is not committed to git — it is regenerated on every build and is only needed to deploy.

---

## Deploying

### Create an API key

The CLI authenticates with an API key, not your password. In your site's admin, go to **Settings → API keys**, create a key, and tick **Install and remove plugins** (and **Upload and update themes** if you'll deploy themes too). Copy the key — it's shown once.

The key only works while the person who created it is still an admin of that site, and only on that site. Treat it like an admin password, and revoke it when you no longer need it.

### First deploy

```bash
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_API_KEY=nf_...

nuxflow plugin deploy
```

`--site` and `--api-key` flags work too, but the environment variable keeps the key out of your shell history.

The deploy command sends `dist/plugin.json` to `/api/v1/dynamic-plugins` with the key as a `Bearer` token. This works the same whether or not the site uses central sign-in. The plugin code is stored in your Cloudflare KV namespace and a database row is created with `isActive: false`.

### Updating an existing plugin

Bump the `version` in `nuxflow.plugin.json`, rebuild, then run:

```bash
nuxflow plugin update
```

This replaces the plugin's code in place (`PUT /api/v1/dynamic-plugins/{id}`), and installs it if it isn't on the site yet. The update must be signed with the same publisher key. The plugin keeps its settings, its stored data and its approval, so an active plugin stays active.

**Except when the update asks for more.** If the new version requests a permission the admin hasn't approved, NuxFlow switches the plugin off and tells the site's admins. It stays off until an admin reviews and re-enables it, so an update can never give itself new powers. A permission the new version no longer asks for is removed from the grant. Settings carry over when their field still exists with the same type.

### Dynamic Plugin Security & Cryptographic Signatures

To prevent unauthorized or arbitrary code execution on your Cloudflare Workers edge environment, NuxFlow enforces strict cryptographic constraints:

1. **Ed25519 Publisher Signing**: Every plugin deployment payload must be signed by the publisher's private key. The deployment payload contains the SPKI Ed25519 `publisherPublicKey` and an Ed25519 `signature` of the canonical payload (`id + version + serverChecksum + clientChecksum + definitionsChecksum`, plus `capabilitiesChecksum` for a plugin that declares permissions or settings, which switches the signed input from `nuxflow-plugin-v1` to `nuxflow-plugin-v2`). That covers `blocks.json` alongside both code bundles, even though it's inert data, and the permissions list, so nothing in a deploy is unsigned and nobody can add a permission to a signed plugin.
2. **WebCrypto API Validation**: Verification runs entirely on Cloudflare Workers using the native **Web Crypto API** (`globalThis.crypto.subtle`), ensuring high-speed validation without heavy external libraries.
3. **KV Code Integrity Checks**: When proxying requests to dynamic plugins, `assertCodeIntegrity()` compares the raw KV source code SHA-256 checksum against the signed D1 database checksum. Any mismatch throws a hard 500 error, blocking tampered KV entries immediately.

#### Installing fully signed bundles via the Admin UI

While the CLI `nuxflow plugin deploy` handles signatures automatically, you can also install signed plugin packages directly from the browser:
- Navigate to **Admin → Plugins** and click **Upload plugin**.
- Paste the complete, signed JSON package outputted by the CLI (which contains the code, checksums, public key, and signature) into the **"Auto-fill from signed plugin JSON"** textarea.
- The UI will automatically parse the package and populate all required fields, including the public key and signature, letting you securely deploy plugins via the dashboard.

---

## Activating in the Admin

After deploying, go to **Admin → Plugins**. Your plugin appears in the list with a status of **Inactive** and its permissions listed. Click **Enable** to activate it.

If the plugin asks for permissions, enabling shows a review screen listing each one in plain words, marked by how much it could affect the site. **Approve and enable** grants exactly that list. Only a signed-in admin can do this: an API key can install and update plugins but never enable them. A plugin with no permissions is enabled straight away. If it declares settings, the ⚙ button opens its settings form.

- The server module is immediately available at `/_nuxflow/ext/{pluginId}/*`.
- The client bundle is served to the browser on the next page load and registers its Canvas blocks automatically. Open any page in the Canvas editor and your block will appear in the block picker.

---

## Testing

### Server endpoints

Once the plugin is active, test its server endpoints directly:

```bash
# Health check
curl https://your-site.workers.dev/_nuxflow/ext/my-plugin/status

# With a query parameter
curl "https://your-site.workers.dev/_nuxflow/ext/my-plugin/greet?name=Alice"
```

You can also test endpoints from a browser. NuxFlow never forwards cookies or `Authorization` headers to a plugin. If an endpoint needs to know who is calling, ask for `user:read` and read the `x-nuxflow-user-id` / `x-nuxflow-user-role` headers (see [Signed-in users](#signed-in-users-userread)).

### Canvas blocks

1. Open any page or post in the Canvas editor (**Admin → Content → [any page] → Canvas mode**)
2. Click **Add block**
3. Find your block by name in the picker (search if needed)
4. Configure its props in the settings panel on the right

If your block does not appear, check:
- The plugin is **Active** in Admin → Plugins
- The client bundle compiled without errors (`nuxflow plugin build` output)
- The browser console for any JS errors during plugin registration

### Local development

Dynamic Workers are not available in `pnpm dev` (Node.js). Use `wrangler dev` from `apps/nuxflow` to get real KV and Worker Loader bindings locally:

```bash
cd apps/nuxflow
npx wrangler dev
```

Note that `wrangler dev` uses a local KV simulation — you will need to deploy the plugin to the local dev environment separately, or test against production. To test hooks fired by scheduled publishing, start it with `npx wrangler dev --test-scheduled` and visit `http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*`.

---

## Plugin Structure Reference

| File | Required | Runtime | Purpose |
|---|---|---|---|
| `nuxflow.plugin.json` | Yes | — | Manifest read by CLI commands: id, version, `permissions`, `settings` |
| `src/server.ts` | No | Cloudflare Worker (sandboxed) | Handles `/_nuxflow/ext/{id}/*` HTTP requests and event hooks |
| `src/nuxflow.ts` | No | — | Types for `env.NUXFLOW` (written by `plugin create`) |
| `src/client.ts` | No | Browser | Registers Canvas blocks on app boot |
| `dist/plugin.json` | Generated | — | Build artefact uploaded by `deploy`/`update` |

---

## Environment Variables for the CLI

| Variable | Flag equivalent | Purpose |
|---|---|---|
| `NUXFLOW_SITE` | `--site` | Base URL of your NuxFlow site |
| `NUXFLOW_API_KEY` | `--api-key` | API key with the "Install and remove plugins" or "Upload and update themes" permission |

---

## Troubleshooting

### Deploy fails with error code 10195

Your Cloudflare account is on the free Workers plan. Upgrade to **Workers Paid** ($5/month) at `https://dash.cloudflare.com/{accountId}/workers/plans`. This is separate from website zone plans — upgrading Cloudflare Pro does not unlock Dynamic Workers.

### `LOADER` binding not listed after deploy

You are using Wrangler 3. Wrangler 3 silently ignores `[[worker_loaders]]` in `wrangler.toml`. Upgrade to Wrangler 4:

```bash
pnpm add -D wrangler@^4 --filter @nuxflow/app
cd apps/nuxflow && npx wrangler deploy
```

### Authentication failed (403): Missing or null Origin

The NuxFlow CLI was not sending the `Origin` header required by Better Auth. Upgrade the CLI to the version that includes this fix (`@nuxflow/cli` 0.1.1 or later).

### 503 — Dynamic Workers not available in this environment

The `LOADER` binding is null at runtime. This happens when the Worker was deployed without the binding (e.g. with Wrangler 3, or before the plan was upgraded). Redeploy with Wrangler 4 after upgrading to Workers Paid.

### "This plugin was not granted the … permission"

The method you called needs a permission that isn't in `nuxflow.plugin.json`, or that the admin hasn't approved yet. Add it to `permissions`, rebuild, run `nuxflow plugin update`, then re-enable the plugin in Admin → Plugins and approve the new permission.

### 503 — Plugin code is not available yet

The plugin was just installed or updated and its code hasn't reached Cloudflare KV in this location yet. It usually resolves within a minute. Nothing is cached in the meantime, so the next request tries again.

### 503 — Plugin capabilities are unavailable

The Worker can't hand out `env.NUXFLOW`. Check that `compatibility_date` in `wrangler.toml` is 2025-11-17 or later (it turns on `ctx.exports`) and that the deployed build uses `server/cloudflare-entry.ts` (set as `nitro.entry` in `nuxt.config.ts`). Plugins without permissions still run.

### A `fetch()` returns 403 "Blocked by NuxFlow"

The address isn't covered by an approved `network:` permission, or isn't plain `https://` on port 443. The response body says which.

### Plugin server returns 500

The most common cause is a syntax error or unsupported API in `src/server.ts`. Check the Wrangler tail logs:

```bash
cd apps/nuxflow
npx wrangler tail
```

Then make a request to `/_nuxflow/ext/{pluginId}/...` and watch the log output for the error.

### Canvas block does not appear after enabling

First check `src/blocks.json` — the block picker only lists ids declared there, and only ids present in `blockDefinitions` are ever requested from `renderBlock()`. If the block is listed but renders as a "failed to render" message, open the *iframe's own* dev tools console (right-click inside the block on the page → Inspect, or open the iframe's `src` URL directly in a new tab) — errors inside the sandbox don't surface in the parent page's console. Common causes:
- `import 'vue'` inside `src/client.ts` — remove it and use the `vue` argument passed to `renderBlock` instead
- A runtime error in the `defineComponent` setup function
- `renderBlock()` returning `null` for a valid id — check the id comparison matches exactly what's in `blocks.json`
- The Canvas plugin is not enabled (dynamic plugin Canvas blocks require the Canvas plugin to be active)
