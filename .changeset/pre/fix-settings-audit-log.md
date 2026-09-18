---
"@nuxflow/app": patch
---

fix: PATCH /api/v1/settings now writes an audit log entry

This endpoint saves payment provider keys, AI provider keys, and (as of this
session) per-site Google/GitHub OAuth client secrets, but never wrote an audit
log entry — unlike every sibling mutation endpoint (content, media, users,
themes). Found during a security review of this session's auth changes: the
new OAuth-secret write path made this a higher-value target than before, with
no record of who changed a credential or when. The audit entry records which
setting keys changed, never the values, since several of them are secrets.
