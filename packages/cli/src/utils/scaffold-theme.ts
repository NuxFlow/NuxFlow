import { outputFile } from 'fs-extra'
import { join } from 'node:path'

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
