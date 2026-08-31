---
"@nuxflow/canvas": patch
---

feat: add an `align` prop to the Text block, mirroring `sanitize-html.ts`'s intentional style-stripping

`sanitize-html.ts` (added in the theme-system security pass, commit `d04dcbb`) strips `style`/`class` from block-level tags (`p`, `h1`-`h6`, etc.) in rich-text content as an XSS/CSS-injection guard — only `span`/`mark` may keep `style`. That's correct and shouldn't be loosened, but it means content that used inline `style="text-align:center"` on a heading or paragraph (a pattern common before this sanitizer existed) silently lost its alignment the moment the sanitizer started actually running in production, with no supported replacement.

`CanvasBlockText.vue` now accepts `align?: 'left' | 'center' | 'right'` (default `'left'`), applied as a `text-{align}` class on the block's own wrapper — component-controlled, not sanitized content, so it's unaffected by the whitelist and inherits down to every child element. Exposed as a `select` field in the block's `CanvasBlockDefinition` so it's editable from the admin canvas editor, not just raw content JSON.

Content that needs per-run visual treatment beyond alignment (e.g. an uppercase/letter-spaced "eyebrow" label) should wrap just that text in `<span style="...">`, which the sanitizer already allows.
