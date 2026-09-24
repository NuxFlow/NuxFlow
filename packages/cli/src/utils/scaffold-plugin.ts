import { outputFile } from 'fs-extra'
import { join } from 'node:path'

export async function scaffoldPlugin(dir: string, id: string, name: string, description: string) {
  const files: Record<string, string> = {
    'nuxflow.plugin.json': JSON.stringify({ id, name, version: '0.1.0', description }, null, 2) + '\n',

    'src/server.ts': `\
// Server-side Cloudflare Worker for the "${name}" plugin.
// NuxFlow routes /_nuxflow/ext/${id}/* to this handler (prefix already stripped).
//
// Docs: https://developers.cloudflare.com/workers/runtime-apis/request/

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/hello') {
      return Response.json({ plugin: '${id}', message: 'Hello from ${name}!' })
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

# 3. Deploy (first time)
nuxflow plugin deploy --site https://your-site.com \\
  --email admin@your-site.com --password yourpassword

# 4. Update after changes
nuxflow plugin build
nuxflow plugin update --site https://your-site.com \\
  --email admin@your-site.com --password yourpassword
\`\`\`

Or use environment variables to avoid repeating flags:

\`\`\`bash
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_EMAIL=admin@your-site.com
export NUXFLOW_PASSWORD=yourpassword

nuxflow plugin build && nuxflow plugin update
\`\`\`

## How it works

| File | Runtime | Purpose |
|---|---|---|
| \`src/server.ts\` | Cloudflare Worker | Handles \`/_nuxflow/ext/${id}/*\` requests |
| \`src/blocks.json\` | Read directly by the trusted app | Block metadata — name, icon, fields, defaultProps |
| \`src/client.ts\` | Sandboxed iframe (no cookie/session access) | Renders the actual Vue component for each block |

After \`nuxflow plugin build\`, both files are compiled to \`dist/\` and base64-encoded
into \`dist/plugin.json\`, which is what the deploy command uploads.

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
