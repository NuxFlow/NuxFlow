# External Plugin Development Guide

NuxFlow supports two kinds of plugins. **Bundled plugins** (Canvas, Contact Form, Payments) are compiled into the Worker at deploy time and live inside the monorepo. **Dynamic plugins** are self-contained packages that you build and upload independently — they run as isolated Cloudflare Workers spawned on demand from code stored in KV, so you can install, update, or remove them without ever redeploying your site.

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
# 1. Scaffold a new plugin
nuxflow plugin create

# 2. Edit src/server.ts and src/client.ts (see below)

# 3. Build
nuxflow plugin build

# 4. Deploy to your site
nuxflow plugin deploy \
  --site https://your-site.workers.dev \
  --email admin@example.com \
  --password yourpassword

# 5. Enable it in Admin → Plugins
```

---

## Scaffold a Plugin

Run `nuxflow plugin create` from any directory. The CLI will prompt for a name and optional description, then create a self-contained project folder:

```
my-plugin/
├── nuxflow.plugin.json   # Plugin manifest (id, name, version, description)
├── src/
│   ├── server.ts         # Cloudflare Worker — handles HTTP requests
│   └── client.ts         # Browser bundle — registers Canvas blocks
├── package.json
└── tsconfig.json
```

### nuxflow.plugin.json

The manifest is read by `nuxflow plugin build` and `nuxflow plugin deploy`. Keep the `id` short, URL-safe, and unique across all plugins on your site.

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "What this plugin does"
}
```

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

## Writing the Client Bundle

`src/client.ts` exports a `register` function that NuxFlow calls once on app boot in the browser. Use it to add blocks to the Canvas page builder.

Vue is passed in as an argument — do not `import` it as a bare specifier, as the bundle must not include a second copy of Vue.

```typescript
// src/client.ts
export function register(
  _app: unknown,
  registry: {
    register: (id: string, entry: { name: string; icon?: string; component: unknown }) => void
  },
  { defineComponent, h }: {
    defineComponent: (opts: object) => unknown
    h: (tag: string | object, props?: object | null, children?: unknown) => unknown
  },
) {
  registry.register('my-plugin/banner', {
    name: 'My Banner',
    icon: 'i-lucide-megaphone',
    component: defineComponent({
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
    }),
  })
}
```

The block ID format is `{pluginId}/{blockName}`. The `icon` accepts any [Iconify](https://icon-sets.iconify.design/) icon string (e.g. `i-lucide-box`).

The client bundle is compiled for the browser (`platform: browser`, `target: es2020`, minified). Both `server.ts` and `client.ts` are optional — you can have a server-only plugin (API endpoints with no Canvas blocks) or a client-only plugin (Canvas blocks with no server endpoints).

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

### First deploy

```bash
nuxflow plugin deploy \
  --site https://your-site.workers.dev \
  --email admin@example.com \
  --password yourpassword
```

Or set environment variables to avoid repeating the flags:

```bash
export NUXFLOW_SITE=https://your-site.workers.dev
export NUXFLOW_EMAIL=admin@example.com
export NUXFLOW_PASSWORD=yourpassword

nuxflow plugin deploy
```

The deploy command authenticates with your NuxFlow admin account and POSTs `dist/plugin.json` to `/api/v1/dynamic-plugins`. The plugin code is stored in your Cloudflare KV namespace and a database row is created with `isActive: false`.

### Updating an existing plugin

Bump the `version` in `nuxflow.plugin.json`, rebuild, then run:

```bash
nuxflow plugin update
```

This removes the old plugin entry and re-installs the new version. If the plugin was active, go to Admin → Plugins and re-enable it after updating.

---

## Activating in the Admin

After deploying, go to **Admin → Plugins**. Your plugin appears in the list with a status of **Inactive**. Click **Enable** to activate it.

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

You can also test unauthenticated endpoints from a browser. Authenticated endpoints (those that need a logged-in user) should read the `Cookie` header forwarded by NuxFlow.

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

Note that `wrangler dev` uses a local KV simulation — you will need to deploy the plugin to the local dev environment separately, or test against production.

---

## Plugin Structure Reference

| File | Required | Runtime | Purpose |
|---|---|---|---|
| `nuxflow.plugin.json` | Yes | — | Manifest read by CLI commands |
| `src/server.ts` | No | Cloudflare Worker | Handles `/_nuxflow/ext/{id}/*` HTTP requests |
| `src/client.ts` | No | Browser | Registers Canvas blocks on app boot |
| `dist/plugin.json` | Generated | — | Build artefact uploaded by `deploy`/`update` |

---

## Environment Variables for the CLI

| Variable | Flag equivalent | Purpose |
|---|---|---|
| `NUXFLOW_SITE` | `--site` | Base URL of your NuxFlow site |
| `NUXFLOW_EMAIL` | `--email` | Admin account email |
| `NUXFLOW_PASSWORD` | `--password` | Admin account password |

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

### Plugin server returns 500

The most common cause is a syntax error or unsupported API in `src/server.ts`. Check the Wrangler tail logs:

```bash
cd apps/nuxflow
npx wrangler tail
```

Then make a request to `/_nuxflow/ext/{pluginId}/...` and watch the log output for the error.

### Canvas block does not appear after enabling

Open the browser dev tools console and look for errors during the `register()` call. Common causes:
- `import 'vue'` inside `src/client.ts` — remove it and use the `vue` argument passed to `register` instead
- A runtime error in the `defineComponent` setup function
- The Canvas plugin is not enabled (dynamic plugin Canvas blocks require the Canvas plugin to be active)
