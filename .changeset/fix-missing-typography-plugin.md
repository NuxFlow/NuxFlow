---
"@nuxflow/app": patch
---

fix: install and register `@tailwindcss/typography` so canvas text blocks render with real default styling

`CanvasBlockText.vue` wraps sanitized rich-text content in `.prose prose-gray dark:prose-invert` — Tailwind Typography's naming convention — but the plugin was never actually installed or registered in `main.css`, so those classes have never had any CSS behind them, in any version of this project. Content that depended on inline `style` attributes for its visual design (e.g. `style="text-align:center"` on a `<p>`/`<h2>`) rendered correctly anyway *until* `sanitize-html.ts`'s XSS whitelist — which deliberately strips `style` from block-level text tags as a CSS-injection guard, only `span`/`mark` may keep it — started being exercised on a fresh deploy, at which point the content fell back to the `.prose` wrapper's (nonexistent) styling and rendered as unstyled, left-aligned text.

Fixed by installing `@tailwindcss/typography` and adding `@plugin '@tailwindcss/typography';` to `apps/nuxflow/app/assets/css/main.css`. This restores sensible default heading/paragraph/list styling for all canvas text blocks site-wide. It does not restore the exact original inline-style-driven design (e.g. centered uppercase eyebrow text) for content that relies on `style` on `p`/`h1-h6` — that sanitizer restriction is intentional and shouldn't be loosened; content needing that level of control should use `span style=""` (which the sanitizer allows) or a dedicated block/utility class instead.
