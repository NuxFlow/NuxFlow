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
// Use registry.register() to add blocks to the Canvas page builder.
// Vue utilities are passed in — do NOT import from 'vue' directly.

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
  registry.register('${id}/example', {
    name: 'Example Block',
    icon: 'i-lucide-box',
    component: defineComponent({
      props: {
        headline: { type: String, default: 'Hello from ${name}' },
        text: { type: String, default: 'Edit this block in the Canvas editor.' },
        bgColor: { type: String, default: '#ffffff' },
      },
      setup(props: Record<string, string>) {
        return () =>
          h('section', { style: { backgroundColor: props.bgColor, padding: '48px 24px', textAlign: 'center' } }, [
            h('h2', { style: { fontSize: '1.875rem', fontWeight: '700', marginBottom: '12px' } }, props.headline),
            h('p', { style: { color: '#6b7280' } }, props.text),
          ])
      },
    }),
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
