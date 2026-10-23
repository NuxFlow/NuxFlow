# Release Rings

**Optional.** This is only for operators who run **more than one NuxFlow deployment**
(separate Workers, each with its own D1). A single install keeps using `pnpm run deploy`
and can skip this page.

Release rings let new code reach your own sites first, and your customers only after it
has run there for two days:

| Ring | What goes there | Gets new code |
|---|---|---|
| **Ring 1** | Deployments you use yourself (a canary) | Straight after merging |
| **Ring 2** | Everything else (customers) | At least 48 hours later: the **same commit** ring 1 got |

Each release is a git tag: `ring1-YYYY-MM-DD` when it goes to ring 1, and `ring2-YYYY-MM-DD`
when that commit is promoted. A second release on the same day gets `-2`, `-3`, and so on.
The tags stay on your machine unless you push them.

## Set up

1. List your deployments in `apps/nuxflow/release-targets.json`. It's gitignored, because
   it names your own wrangler config files. Start from the example:

   ```bash
   cp apps/nuxflow/release-targets.example.json apps/nuxflow/release-targets.json
   ```

   ```json
   {
     "targets": [
       { "name": "canary", "ring": 1, "config": "wrangler.canary.toml", "checkUrl": "https://canary.example.com/" },
       { "name": "main", "ring": 2, "config": "wrangler.toml", "checkUrl": "https://example.com/" }
     ]
   }
   ```

   - `config` is a wrangler config file in `apps/nuxflow`.
   - `checkUrl` (optional) is a public page loaded after deploying. The script checks that it
     loads and that the page cache answers `HIT`.
   - You need at least one ring 1 deployment.

2. Be signed in to Cloudflare (`wrangler login`) as usual.

## Release

```bash
pnpm ring:canary
```

This command:

- Checks you're on `main`, with no uncommitted changes, and exactly in step with GitHub.
- Tags the commit (`ring1-…`).
- Says whether the release changes the database (new migration files since the last ring 1
  release). A rollback can't undo those.
- Asks you to type `yes`, then deploys every ring 1 deployment.

Use your own sites for two days, then:

```bash
pnpm ring:promote
```

This command:

- Takes the newest ring 1 release.
- Refuses until it's 48 hours old.
- Deploys **that exact commit** to every ring 2 deployment. If `main` has moved on, it
  switches to the tagged commit for the deploy, reinstalls packages if they differ, then
  switches back.
- Tags it `ring2-…`.
- Warns about database changes since what ring 2 runs now, and when the promotion would be
  a rollback.

To see where things stand at any time (this changes nothing):

```bash
pnpm ring:status
```

| Option | Commands | Meaning |
|---|---|---|
| `--dry-run` | canary, promote | Show what would happen; change nothing |
| `--yes` | canary, promote | Don't ask for confirmation |
| `--urgent` | promote | Skip the 48-hour wait. Only for security fixes. |
| `--tag ring1-…` | promote | Promote that release instead of the newest |

## Member pools

A hosting platform can spread its sites over several Workers, each with its own database
("pools"), so particular clients can be kept apart and each pool can be on its own ring.
`pnpm pool:create <name> --from <control plane config> --ring 1|2` sets one up and adds it
to `release-targets.json`, so `ring:canary` and `ring:promote` deploy it with the rest of
its ring. See [Member Pools](./pools.md). Nothing about pools applies to an ordinary install.

## Which version is running

Each deployment records its release and git commit (`NUXT_BUILD_RELEASE`,
`NUXT_BUILD_COMMIT`, passed to `wrangler deploy --var`). A super admin sees them under
**Super Admin → Platform → Running version**. They're never sent to visitors.

The Cloudflare version also gets the release as its tag and message. It shows in
**Workers & Pages → (your Worker) → Deployments**, which helps when picking a version to roll
back to. Rolling back is only safe if no database migration came in between.
