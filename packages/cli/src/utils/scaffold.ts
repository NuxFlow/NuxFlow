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

export async function scaffoldTheme(dir: string, name: string) {
  const files: Record<string, string> = {
    'nuxflow.theme.json': JSON.stringify({ name, version: '1.0.0' }, null, 2) + '\n',

    'theme.css': `\
/*
 * ${name} — NuxFlow CSS Theme
 *
 * This stylesheet is injected into the <head> of every SSR page render.
 * Use the selectors and custom properties below, or write any CSS you need.
 *
 * Deploy:  nuxflow theme deploy --site https://your-site.com
 * Update:  nuxflow theme update --site https://your-site.com  (after first deploy)
 *
 * Full token/selector reference: themes/default/assets/css/theme.css in the
 * NuxFlow repo (also covers admin-dashboard chrome, which this starter omits).
 */


/* ─────────────────────────────────────────────────────────────────────────────
   Appearance settings bridge
   ─────────────────────────────────────────────────────────────────────────────
   Two custom properties are injected automatically into every public page from
   Admin → Themes → Appearance — reference them so a single admin setting can
   drive your whole theme. Both ship with a safe fallback.

     --nuxflow-primary   The "Accent colour" value chosen in the picker.
     --nuxflow-font      The "Body font" value (font-family stack).

   Example: .canvas-hero a { background: var(--nuxflow-primary, #6366f1); }
   ───────────────────────────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────────────────────────
   Canvas block selectors
   ─────────────────────────────────────────────────────────────────────────────
   Every Canvas block renders with a semantic class on its root element. Target
   these to style pages built with the visual page builder. All blocks sit
   inside .nux-blocks. (canvas-video has no stable wrapper class yet — inspect
   the rendered HTML if you need to target it.)

     .canvas-hero          Hero / banner section
     .canvas-text          Rich text / prose block
     .canvas-image         Image block (figure inside holds the image)
     .canvas-columns       Multi-column layout block
     .canvas-container     Generic container / nesting block
     .canvas-features      Feature grid section
     .canvas-testimonial   Testimonial / quote card block
     .canvas-cta           Call-to-action banner block
     .canvas-spacer        Vertical spacer / divider block
     .canvas-gdpr          Cookie / GDPR consent banner block
     .canvas-footer        Footer block
     .canvas-button        Standalone button block
     .canvas-accordion     Accordion / FAQ block
     .canvas-pricing       Pricing table block
     .canvas-gallery       Image gallery block
     .canvas-carousel      Carousel / slider block
     .canvas-calendar      Calendar / events block

   Canvas pages render full-width with no container — add max-width constraints
   inside your own selectors for large-screen layouts.

   .nux-content wraps TipTap-rendered rich text on non-Canvas pages (blog posts,
   simple content pages).
   ───────────────────────────────────────────────────────────────────────────── */

/* Style the hero headline with gradient text: */
/* .canvas-hero h1 {
  background: linear-gradient(135deg, #fff 30%, var(--nuxflow-primary, #6366f1) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
} */

/* Body copy follows the admin-configured font automatically: */
/* body { font-family: var(--nuxflow-font, system-ui, -apple-system, sans-serif); } */

.nux-content a       { color: var(--nuxflow-primary, #6366f1); }
.nux-content blockquote { border-left-color: var(--nuxflow-primary, #6366f1); }
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

## Bundling demo content (optional)

A theme can ship with seed content — pages, posts, menus, forms — that the
admin can one-click import after activating the theme (Admin → Themes →
Import demo content). To include it:

1. Build the pages/posts/menus/forms you want to ship on a real NuxFlow site.
2. Export them: \`GET /api/v1/backup\` on that site (admin-only) downloads a zip
   containing \`backup.json\` + an \`images/\` folder.
3. Copy \`backup.json\` into this folder as \`demo.json\`, and copy the \`images/\`
   folder alongside it.
4. Run \`nuxflow theme deploy\` again — the CLI automatically zips
   \`theme.css\` + \`theme.json\` + \`demo.json\` + \`images/\` and uploads the
   bundle instead of a bare CSS payload whenever \`demo.json\` or \`images/\`
   is present.

Bundled (zip) deploys always create a new theme — the \`update\` command only
patches CSS on an existing theme, since demo content is a one-time import, not
something that's re-synced.
`,
  }

  for (const [filePath, content] of Object.entries(files)) {
    await outputFile(join(dir, filePath), content)
  }
}
