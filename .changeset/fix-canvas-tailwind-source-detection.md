---
"@nuxflow/app": patch
---

fix: register `@nuxflow/canvas` as an explicit Tailwind `@source` so its utility classes aren't dropped from the build

`@nuxflow/canvas` is a plain workspace dependency, not a Nuxt layer, so Nuxt UI's automatic per-layer `@source` generation never covered it. This silently dropped any Tailwind utility class used only inside `packages/canvas/src/**/*.vue` (and nowhere in `apps/nuxflow/app`) from the compiled CSS — surfaced after the Nuxt UI v4 upgrade as visibly broken styling across canvas-rendered pages (e.g. the homepage hero CTA buttons losing their padding and one of their two utility-class-driven visual states). Verified by diffing the live site's compiled CSS against the component source: classes like `px-7`, used only in `CanvasBlockHero.vue`, were entirely absent from the bundle, while classes shared with `apps/nuxflow/app` templates still worked (since those got picked up incidentally via the app's own scanned files). Fixed by adding an explicit `@source '../../../../../packages/canvas/src/**/*.{vue,ts}'` directive to `apps/nuxflow/app/assets/css/main.css`, per Tailwind v4's documented pattern for monorepo workspace packages outside the CSS entry point's own directory tree.
