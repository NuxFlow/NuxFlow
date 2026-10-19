import { outputFile } from 'fs-extra'
import { join } from 'node:path'

export async function scaffoldPlugin(dir: string, id: string, name: string, description: string) {
  const files: Record<string, string> = {
    'nuxflow.plugin.json': JSON.stringify({
      id,
      name,
      version: '0.1.0',
      description,
      // What this plugin asks to be allowed to do. An admin sees these in plain words and
      // approves them when enabling the plugin; ask only for what you use.
      permissions: ['storage'],
      // A settings form NuxFlow shows the admin. Read the values with env.NUXFLOW.getSettings().
      settings: [
        { key: 'greeting', label: 'Greeting', type: 'text', default: 'Hello', description: 'Shown by the example block.' },
      ],
    }, null, 2) + '\n',

    'src/nuxflow.ts': `\
// Types for what NuxFlow gives this plugin's server module. There is no SDK package to
// install — this file is yours; keep the parts you use. Full reference: docs/plugins.md.
//
// \`env.NUXFLOW\` is the only way to reach the site. Each method works only if its
// permission is in nuxflow.plugin.json and an admin approved it — otherwise the call
// throws with a message saying which permission is missing.

export interface NuxflowContentSummary {
  id: string
  type: string
  title: string
  slug: string
  path: string
  locale: string
  excerpt: string | null
  seoTitle: string | null
  seoDescription: string | null
  ogImage: string | null
  publishedAt: string | null
  updatedAt: string
}

export interface NuxflowHost {
  /** Values of the settings declared in nuxflow.plugin.json (no permission needed). */
  getSettings(): Promise<Record<string, unknown>>

  // permission: storage — this plugin's own data, up to 10 MB / 10,000 keys
  storageGet(key: string): Promise<unknown>
  storagePut(key: string, value: unknown, options?: { ttlSeconds?: number }): Promise<void>
  storageDelete(key: string): Promise<void>
  storageList(options?: { prefix?: string, cursor?: string, limit?: number }): Promise<{ keys: { key: string, size: number, expiresAt: string | null }[], cursor: string | null }>

  // permission: content:read — published, public content only
  listContent(options?: { type?: string, locale?: string, limit?: number, offset?: number }): Promise<{ items: NuxflowContentSummary[] }>
  getContent(options: { id?: string, slug?: string }): Promise<(NuxflowContentSummary & { content: unknown, markdown: string }) | null>

  // permission: content:write — creates drafts; publishing stays with the site's editors
  createDraft(input: { title: string, html?: string, type?: string, slug?: string, excerpt?: string, seoTitle?: string, seoDescription?: string }): Promise<{ id: string, slug: string }>

  // permission: ai — the site's AI provider, counted towards its AI usage
  generateText(input: { prompt: string, system?: string, maxOutputTokens?: number }): Promise<{ text: string }>

  // permission: notify — in-app notification to the site's admins
  notifyAdmins(input: { title: string, body: string, url?: string }): Promise<{ sent: number }>
}

export interface Env {
  NUXFLOW: NuxflowHost
}

/** Body of an event hook delivery (permission: hook:<event>), POSTed to /__nuxflow/hooks/<event>. */
export interface NuxflowHookDelivery<T = Record<string, unknown>> {
  event: string
  occurredAt: string
  data: T
}

/**
 * With the user:read permission, requests from a signed-in person carry these headers
 * (set by NuxFlow — a visitor can't fake them). Absent for anonymous requests.
 */
export function nuxflowUser(request: Request): { id: string, role: string | null } | null {
  const id = request.headers.get('x-nuxflow-user-id')
  return id ? { id, role: request.headers.get('x-nuxflow-user-role') } : null
}
`,

    'src/server.ts': `\
// Server-side Cloudflare Worker for the "${name}" plugin.
// NuxFlow routes /_nuxflow/ext/${id}/* to this handler (prefix already stripped).
//
// It runs in its own sandbox: no database, no cookies, and no network access unless
// nuxflow.plugin.json asks for "network:<host>" permissions. Everything it can do on the
// site goes through env.NUXFLOW — see src/nuxflow.ts.

import type { Env, NuxflowHookDelivery } from './nuxflow'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Event hooks arrive here, sent by NuxFlow itself (visitors can't reach this path).
    // Add e.g. "hook:content.published" to permissions to receive one.
    if (request.method === 'POST' && url.pathname.startsWith('/__nuxflow/hooks/')) {
      const delivery = await request.json() as NuxflowHookDelivery
      console.log('Hook received:', delivery.event)
      return new Response(null, { status: 204 })
    }

    if (request.method === 'GET' && url.pathname === '/hello') {
      const settings = await env.NUXFLOW.getSettings()
      // A visit counter kept in the plugin's own storage (permission: storage).
      const visits = Number(await env.NUXFLOW.storageGet('visits') ?? 0) + 1
      await env.NUXFLOW.storagePut('visits', visits)
      return Response.json({ message: \`\${settings.greeting ?? 'Hello'} from ${name}!\`, visits })
    }

    return new Response('Not found', { status: 404 })
  },
}
`,

    'src/blocks.json': JSON.stringify([
      {
        id: `${id}/example`,
        name: 'Example Block',
        description: `Starter block from the ${name} plugin.`,
        icon: 'i-lucide-box',
        category: 'advanced',
        thumbnailColor: '#f0fdf4',
        fields: [
          { key: 'headline', label: 'Headline', type: 'text', placeholder: `Hello from ${name}` },
          { key: 'text', label: 'Body text', type: 'textarea' },
          { key: 'bgColor', label: 'Background colour', type: 'color' },
          { key: 'padding', label: 'Padding', type: 'spacing' },
        ],
        defaultProps: {
          headline: `Hello from ${name}`,
          text: 'Edit this block in the Canvas editor.',
          bgColor: '#ffffff',
          padding: { top: 48, right: 24, bottom: 48, left: 24, unit: 'px' },
        },
      },
    ], null, 2) + '\n',

    'src/client.ts': `\
// Client-side render logic for the "${name}" plugin.
//
// This file runs INSIDE A SANDBOXED IFRAME with no access to the page it's
// embedded in — no cookies, no localStorage, no reaching outside the frame
// except via the props NuxFlow passes in. Block metadata (name, icon, fields,
// defaultProps — everything the Canvas editor's settings panel needs) lives in
// src/blocks.json instead, since the trusted app reads that directly without
// ever running this file.
//
// Rules:
//   1. Never \`import from 'vue'\` — the full Vue module is the 2nd argument.
//   2. Never \`import from '@nuxflow/*'\` — there is no shared SDK package.
//   3. All third-party deps must be bundled (esbuild does this automatically).

// The vue argument is \`import * as vue from 'vue'\` — add more entries as needed.
interface VueLike {
  defineComponent: (opts: object) => unknown
  ref: <T>(value: T) => { value: T }
  onMounted: (fn: () => void | Promise<void>) => void
  computed: <T>(fn: () => T) => { value: T }
  h: (tag: string | object, props?: Record<string, unknown> | null, children?: unknown) => unknown
}

interface Props {
  headline: string; text: string; bgColor: string
  padding: { top: number; right: number; bottom: number; left: number; unit: string }
}

// Called once per rendered block instance, inside the sandbox iframe. Return the
// Vue component for the given block id (matching an id declared in blocks.json),
// or null if this plugin doesn't know that id.
export function renderBlock(blockId: string, vue: VueLike): unknown {
  if (blockId !== '${id}/example') return null

  const { defineComponent, ref, onMounted, h } = vue

  return defineComponent({
    props: {
      headline: { type: String, default: 'Hello from ${name}' },
      text:     { type: String, default: 'Edit this block in the Canvas editor.' },
      bgColor:  { type: String, default: '#ffffff' },
      padding:  { type: Object, default: () => ({ top: 48, right: 24, bottom: 48, left: 24, unit: 'px' }) },
    },
    setup(props: Props) {
      // Example: fetch extra data from the plugin's own server route (src/server.ts).
      // Server routes are served at /_nuxflow/ext/${id}/{path} and never receive the
      // site visitor's cookies — this is a cross-origin fetch from inside the sandbox.
      const extra = ref<string | null>(null)

      onMounted(async () => {
        const res = await fetch('/_nuxflow/ext/${id}/hello').catch(() => null)
        if (res?.ok) {
          const data = await res.json() as { message?: string }
          extra.value = data.message ?? null
        }
      })

      // setup() returns a render function (Vue 3 composition API).
      return () => {
        const p = props.padding
        const pad = \`\${p.top}\${p.unit} \${p.right}\${p.unit} \${p.bottom}\${p.unit} \${p.left}\${p.unit}\`
        return h('section', {
          style: { backgroundColor: props.bgColor, padding: pad, textAlign: 'center' },
        }, [
          h('h2', { style: { fontSize: '1.875rem', fontWeight: '700', marginBottom: '12px' } }, props.headline),
          h('p',  { style: { color: '#6b7280' } }, extra.value ?? props.text),
        ])
      }
    },
  })
}
`,

    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        lib: ['ESNext', 'DOM'],
        noEmit: true,
      },
      include: ['src'],
    }, null, 2) + '\n',

    'package.json': JSON.stringify({
      name: id,
      version: '0.1.0',
      type: 'module',
      private: true,
      scripts: {
        build: 'nuxflow plugin build',
        deploy: 'nuxflow plugin deploy',
        update: 'nuxflow plugin update',
      },
    }, null, 2) + '\n',

    'README.md': `# ${name}

A NuxFlow dynamic plugin.

## Quick start

\`\`\`bash
# 1. Edit the plugin source
#    src/server.ts   — Cloudflare Worker (server API)
#    src/blocks.json — Block metadata (name, icon, fields, defaultProps)
#    src/client.ts   — Vue render logic (runs inside a sandboxed iframe)

# 2. Build
nuxflow plugin build

# 3. Create an API key on your site: Admin → Settings → API keys, with
#    "Install and remove plugins". Environment variables keep it out of shell history:
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_API_KEY=nf_...

# 4. Deploy (first time)
nuxflow plugin deploy

# 5. Update after changes
nuxflow plugin build && nuxflow plugin update
\`\`\`

\`--site\` and \`--api-key\` flags work too, instead of the environment variables.

## How it works

| File | Runtime | Purpose |
|---|---|---|
| \`nuxflow.plugin.json\` | Read by the CLI and the site | Id, version, **permissions** and **settings** form |
| \`src/server.ts\` | Cloudflare Worker (sandboxed) | Handles \`/_nuxflow/ext/${id}/*\` requests and event hooks |
| \`src/nuxflow.ts\` | — | Types for \`env.NUXFLOW\`, what the site lets the plugin do |
| \`src/blocks.json\` | Read directly by the trusted app | Block metadata — name, icon, fields, defaultProps |
| \`src/client.ts\` | Sandboxed iframe (no cookie/session access) | Renders the actual Vue component for each block |

After \`nuxflow plugin build\`, both files are compiled to \`dist/\` and base64-encoded
into \`dist/plugin.json\`, which is what the deploy command uploads.

## Permissions

The plugin runs in a sandbox with no database and no network of its own. Anything it does
on the site goes through \`env.NUXFLOW\`, and only for permissions listed in
\`nuxflow.plugin.json\` that an admin approved when enabling it:

| Permission | Lets the plugin |
|---|---|
| \`storage\` | Keep its own data (\`storageGet/Put/Delete/List\`) |
| \`content:read\` | Read published, public content |
| \`content:write\` | Create drafts |
| \`ai\` | Generate text with the site's AI provider |
| \`notify\` | Send admins an in-app notification |
| \`user:read\` | Know the signed-in user's id and role on its own routes |
| \`network:api.example.com\` | Call that host over HTTPS (\`*.example.com\` for subdomains) |
| \`hook:content.published\` | Be told about events (also \`content.updated\`, \`content.unpublished\`, \`form.submitted\`, \`comment.created\`) |

An update that asks for a new permission is switched off until an admin approves it again.

## Blocks registered

| ID | Description |
|---|---|
| \`${id}/example\` | Starter example — replace with your own |

Enable this plugin in the NuxFlow admin → Plugins after deploying.
`,
  }

  for (const [filePath, content] of Object.entries(files)) {
    await outputFile(join(dir, filePath), content)
  }
}
