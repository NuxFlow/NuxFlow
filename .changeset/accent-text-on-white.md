---
"@nuxflow/canvas": patch
---

fix: readable accent-coloured text on light pages

Accent-coloured text in blocks (Calendar dates and months, Class passes sessions, Pricing ticks and similar) uses a darker version of a light accent in light mode, so it reads at 4.5:1 on white.
