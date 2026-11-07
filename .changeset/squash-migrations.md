---
"@nuxflow/db": minor
"@nuxflow/app": minor
---

chore: squash the D1 migration history before the first release

- The migration history is replaced by `0000_schema.sql` (generated from the current schema) and `0001_search.sql` (the hand-written full-text search table and triggers). The resulting database has the same tables, columns, indexes and triggers as before.
- **Breaking for existing databases:** a database created with the old migrations must be recreated (export per-site backups first, then restore them onto the new database). The migration runner tracks applied files by name, so it can't upgrade an old database to the new baseline.
