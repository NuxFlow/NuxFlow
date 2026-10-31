---
"@nuxflow/app": patch
"@nuxflow/canvas": patch
"@nuxflow/db": patch
---

Pre-release code health pass.

- Search works for every language: queries in non-Latin scripts no longer fail, and case and accents are ignored (the search index is rebuilt by migration `0010_search_unicode.sql`). Search results and RSS/Atom items link to each page's public address, so translations open at `/{language}/{page}`.
- The Atom feed blocks `javascript:` links, and both feeds render posts with the same renderer as the site.
- Dates in the admin and on public pages show correctly in Safari and in the viewer's own timezone.
- A signed-in visitor who sends the contact form now gets the "message received" notification when that push event is switched on.
- The MCP server uses the stateless Streamable HTTP transport (the old SSE transport is gone); see docs/mcp.md for client setup.
- Admin error messages now include the server's reason in more places.
- Removed dead code and unused dependencies (including Pinia), and replaced duplicated helpers with one shared copy each.
