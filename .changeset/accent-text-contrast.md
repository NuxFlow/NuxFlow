---
"@nuxflow/canvas": patch
---

fix: readable text on accent-coloured buttons

The Calendar, Class passes, Product and Gallery blocks used white text on the accent colour, which on light accents (such as the default green, about 1.8:1) was hard to read. They now use `--nuxflow-on-primary`: white or dark, whichever reads better on the site's accent.
