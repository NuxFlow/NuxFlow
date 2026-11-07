---
"@nuxflow/canvas": patch
"@nuxflow/app": patch
---

fix: Canvas pages render on the server again

Every Canvas block was missing from the server-rendered HTML: pages arrived empty and their content only appeared once the browser had loaded and run the JavaScript. Search engines and AI crawlers that don't run JavaScript saw no content at all, and visitors saw the page fill in a moment after loading. Blocks now render on the server as intended.
