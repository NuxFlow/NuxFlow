## Summary

<!-- What does this PR change and why? Link the related issue if there is one. Closes #ISSUE_NUMBER -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor (no behaviour change)
- [ ] Chore (dependencies, tooling)

## Changes

<!-- List the key files / areas changed and why. -->

## Testing

- [ ] Unit tests added / updated
- [ ] Tested manually against the dev server
- [ ] E2E tests added / updated (if applicable)

**Manual test steps:**

1.
2.

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] No `node:*` imports added (Cloudflare Workers constraint)
- [ ] No dynamic `require()` calls added
- [ ] No in-memory state added (must be DB-backed)
- [ ] All new API routes use `requireRole()` or `requireAuth()`
- [ ] All new API routes scope DB queries to `event.context.site.id`
- [ ] Mutations call `writeAuditLog()`
- [ ] Commit messages follow Conventional Commits format
