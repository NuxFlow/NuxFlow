import { outputFile } from 'fs-extra'
import { join } from 'path'

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

    'src/client.ts': `\
// Client-side bundle for the "${name}" plugin.
// NuxFlow calls register(app, registry, vue) once on app boot.
//
// Rules:
//   1. Never \`import from 'vue'\` — the full Vue module is the 3rd argument.
//   2. Never \`import from '@nuxflow/*'\` — use the registry/app args instead.
//   3. All third-party deps must be bundled (esbuild does this automatically).

// ── Inline types (do not import from @nuxflow/plugin-canvas) ─────────────────
// Copy and extend these interfaces in your own plugin.

type FieldType = 'text' | 'textarea' | 'number' | 'color' | 'select' | 'toggle' | 'image' | 'url' | 'spacing'

interface BlockDefinition {
  id: string; name: string; description?: string; icon: string
  category: 'layout' | 'content' | 'media' | 'cta' | 'plugin'
  thumbnailColor?: string
  fields: Array<{
    key: string; label: string; type: FieldType
    placeholder?: string; options?: Array<{ label: string; value: string }>
    min?: number; max?: number; step?: number; rows?: number
  }>
  defaultProps: Record<string, unknown>
}

interface Registry {
  register: (id: string, entry: {
    name: string; description?: string; icon?: string; component: unknown
    // Pass a definition so the Canvas sidebar shows editable fields for this block.
    // Without it the block has no configurable props in the admin editor.
    definition?: BlockDefinition
  }) => void
}

// The vue argument is \`import * as vue from 'vue'\` — add more entries as needed.
interface VueLike {
  defineComponent: (opts: object) => unknown
  ref: <T>(value: T) => { value: T }
  onMounted: (fn: () => void | Promise<void>) => void
  computed: <T>(fn: () => T) => { value: T }
  h: (tag: string | object, props?: Record<string, unknown> | null, children?: unknown) => unknown
}

// ── Block definition ──────────────────────────────────────────────────────────
// Centralising defaultProps here keeps them in sync between the definition
// (which the Canvas editor uses) and the component prop declarations below.

const EXAMPLE_BLOCK: BlockDefinition = {
  id: '${id}/example',
  name: 'Example Block',
  description: 'Starter block from the ${name} plugin.',
  icon: 'i-lucide-box',
  category: 'plugin',
  thumbnailColor: '#f0fdf4',
  fields: [
    { key: 'headline', label: 'Headline',         type: 'text',     placeholder: 'Hello from ${name}' },
    { key: 'text',     label: 'Body text',         type: 'textarea'                                    },
    { key: 'bgColor',  label: 'Background colour', type: 'color'                                       },
    { key: 'padding',  label: 'Padding',           type: 'spacing'                                     },
  ],
  defaultProps: {
    headline: 'Hello from ${name}',
    text:     'Edit this block in the Canvas editor.',
    bgColor:  '#ffffff',
    padding:  { top: 48, right: 24, bottom: 48, left: 24, unit: 'px' },
  },
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function register(_app: unknown, registry: Registry, vue: VueLike): void {
  const { defineComponent, ref, onMounted, h } = vue

  interface Props {
    headline: string; text: string; bgColor: string
    padding: { top: number; right: number; bottom: number; left: number; unit: string }
  }

  const ExampleBlock = defineComponent({
    props: {
      headline: { type: String, default: EXAMPLE_BLOCK.defaultProps.headline },
      text:     { type: String, default: EXAMPLE_BLOCK.defaultProps.text     },
      bgColor:  { type: String, default: EXAMPLE_BLOCK.defaultProps.bgColor  },
      padding:  { type: Object, default: () => ({ ...EXAMPLE_BLOCK.defaultProps.padding }) },
    },
    setup(props: Props) {
      // Example: fetch extra data from the plugin's own server route (src/server.ts).
      // Server routes are served at /_nuxflow/ext/${id}/{path}.
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

  registry.register('${id}/example', {
    name:        EXAMPLE_BLOCK.name,
    description: EXAMPLE_BLOCK.description,
    icon:        EXAMPLE_BLOCK.icon,
    component:   ExampleBlock,
    definition:  EXAMPLE_BLOCK,
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
#    src/server.ts  — Cloudflare Worker (server API)
#    src/client.ts  — Vue block registration (page builder)

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
| \`src/client.ts\` | Browser | Registers Canvas blocks on app boot |

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

export async function scaffoldTheme(dir: string, name: string) {
  const files: Record<string, string> = {
    'nuxflow.theme.json': JSON.stringify({ name, version: '1.0.0' }, null, 2) + '\n',

    'theme.css': `\
/*
 * ${name} — NuxFlow CSS Theme
 *
 * This stylesheet is injected into the <head> of every SSR page render.
 * Use CSS custom properties to override design tokens, or write any CSS you need.
 *
 * Deploy:  nuxflow theme deploy --site https://your-site.com
 * Update:  nuxflow theme update --site https://your-site.com  (after first deploy)
 */

:root {
  /* ── Brand colours ─────────────────────────────────────── */
  --color-primary-50:  #eef2ff;
  --color-primary-100: #e0e7ff;
  --color-primary-400: #818cf8;
  --color-primary-500: #6366f1;
  --color-primary-600: #4f46e5;

  /* ── Typography ────────────────────────────────────────── */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;

  /* ── Border radius ─────────────────────────────────────── */
  --radius-sm:   0.25rem;
  --radius-md:   0.5rem;
  --radius-lg:   0.75rem;
  --radius-xl:   1rem;
  --radius-2xl:  1.5rem;
}

/* Example overrides — uncomment and edit as needed:

body {
  font-family: var(--font-sans);
}

.btn-primary {
  background-color: var(--color-primary-500);
  border-radius: var(--radius-lg);
}

*/
`,

    'README.md': `# ${name}

A NuxFlow CSS theme.

## Quick start

\`\`\`bash
# Deploy for the first time (activates automatically if no theme is active)
nuxflow theme deploy --site https://your-site.com \\
  --email admin@your-site.com --password yourpassword

# Update CSS after making changes
nuxflow theme update --site https://your-site.com \\
  --email admin@your-site.com --password yourpassword
\`\`\`

The \`deployedId\` field in \`nuxflow.theme.json\` is written automatically on first deploy
so the update command knows which theme to patch.

## How it works

The CSS in \`theme.css\` is stored in Cloudflare KV and injected into the HTML
\`<head>\` on every server-rendered page — no redeploy required.
`,
  }

  for (const [filePath, content] of Object.entries(files)) {
    await outputFile(join(dir, filePath), content)
  }
}
