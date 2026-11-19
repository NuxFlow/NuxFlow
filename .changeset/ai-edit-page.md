---
"@nuxflow/canvas": patch
---

feat: change an existing Canvas page with AI

The editor's AI button gains a "Change this page" mode: say what you'd like changed and the AI returns edits to the page (change, add, remove or move blocks), checked against the block definitions. The result opens as a preview with the changed blocks outlined and a list of what changed; keep it, try again, or discard it. Adds `CanvasHost.editPage`, `describePageForAi()` and `applyAiPageEdits()`.
