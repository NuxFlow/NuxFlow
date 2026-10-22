// pnpm ring:canary — tag the current main as a ring 1 release and deploy it to every
// ring 1 deployment in release-targets.json. See docs/release-rings.md.
//
//   --dry-run   show what would happen; change nothing
//   --yes       don't ask for confirmation
import { RING1_PREFIX, localDateStamp, newestTag, nextTagName, parseFlags, releaseLogLine } from './lib'
import {
  SMOKE_CHECKLIST,
  checkTarget,
  confirm,
  createTag,
  deployTarget,
  describeTargets,
  fail,
  heading,
  headCommit,
  loadTargets,
  migrationsBetween,
  requireCleanTree,
  requireMain,
  requireUpToDateWithOrigin,
  ringTags,
  runMain,
  shortSha,
} from './shell'

const HELP = `pnpm ring:canary [--dry-run] [--yes]

Tags the current main as a ring 1 release (ring1-YYYY-MM-DD) and deploys it to every
ring 1 deployment in apps/nuxflow/release-targets.json. Promote it to ring 2 at least
48 hours later with: pnpm ring:promote`

runMain(async () => {
  const flags = parseFlags(process.argv.slice(2), ['dryRun', 'yes'])
  if (flags.help) return console.log(HELP)

  const targets = loadTargets().filter(t => t.ring === 1)
  requireMain()
  requireCleanTree()
  requireUpToDateWithOrigin()

  const commit = headCommit()
  const tags = ringTags()
  // Re-running after a failed deploy reuses the tag already on this commit.
  const existing = tags.find(t => t.name.startsWith(RING1_PREFIX) && t.commit === commit)
  const tag = existing?.name ?? nextTagName(RING1_PREFIX, new Date(), tags.map(t => t.name))
  const previous = newestTag(tags.filter(t => t.commit !== commit), RING1_PREFIX)
  const migrations = previous ? migrationsBetween(previous.commit, commit) : null

  heading('Ring 1 release')
  console.log(`Commit:   ${shortSha(commit)} (main, same as GitHub)`)
  console.log(`Tag:      ${tag}${existing ? ' (already on this commit, reused)' : ' (new)'}`)
  console.log(`Deploy:\n${describeTargets(targets)}`)
  if (!previous) {
    console.log('Database: first ring 1 release, nothing to compare with.')
  } else if (migrations!.length) {
    console.log(`Database: ⚠ CHANGES since ${previous.name}:\n${migrations!.map(m => `  • ${m}`).join('\n')}`)
    console.log('          A rollback can\'t undo these. Watch the next two days closely.')
  } else {
    console.log(`Database: no changes since ${previous.name}.`)
  }

  if (flags.dryRun) {
    console.log('\nDry run: nothing was tagged or deployed.')
    return
  }
  await confirm(`Deploy ${tag} to ring 1?`, flags.yes)

  if (!existing) createTag(tag, `Ring 1 release ${localDateStamp(new Date())}`)

  const failed = targets.filter(t => !deployTarget(t, { tag, commit }))
  if (failed.length) {
    fail(`Deploy failed for: ${failed.map(t => t.name).join(', ')} (see above).\nThe tag ${tag} stays; fix the problem and run pnpm ring:canary again.`)
  }

  heading('Checks')
  for (const t of targets) console.log(await checkTarget(t))

  heading('Now check by hand (5 minutes)')
  for (const line of SMOKE_CHECKLIST) console.log(`  [ ] ${line}`)

  heading('For your release log (doc 14)')
  console.log(releaseLogLine({ date: new Date(), tag, dbChange: migrations ? migrations.length > 0 : null }))
  console.log(`\nDone. Use your own sites for 2 days, then run: pnpm ring:promote`)
})
