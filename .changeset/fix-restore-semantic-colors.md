---
"@nuxflow/app": patch
---

fix: restore Nuxt UI semantic color slots and migrate off raw color names

`nuxt.config.ts` registered a custom `ui.theme.colors` list (`['green', 'red', 'blue', 'yellow', 'orange', 'gray']`) that silently replaced Nuxt UI's built-in semantic slots instead of extending them — only `primary` and `neutral` survive an override like this, so `secondary`, `success`, `info`, `warning`, and `error` were dropped project-wide. Every "danger/success/info" UI element in the app had been written against the raw color names instead, since that was the only palette that actually worked — a fragile, undocumented side-channel with no guarantee the module keeps generating CSS for it. One of these (the Danger Zone delete button) had already silently lost its styling entirely and rendered with no visible color.

Restored the semantic slots and migrated ~190 call sites (buttons, badges, alerts, toasts, and a couple of local `Color` type unions) across the app to use them (`red`→`error`, `green`→`success`, `blue`→`info`, `yellow`→`warning`, `gray`→`neutral`). `orange` has no semantic equivalent and stays registered as a genuine custom color in the few places it's used for a distinction that isn't error/success/warning/info.
