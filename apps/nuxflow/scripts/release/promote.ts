// pnpm ring:promote — deploy the newest ring 1 release, the exact commit ring 1 got,
// to every ring 2 deployment in release-targets.json, once it has run on ring 1 for 48
// hours. See docs/release-rings.md.
//
//   --tag ring1-…   promote that release instead of the newest
//   --urgent        skip the 48-hour wait (security fixes)
//   --dry-run       show what would happen; change nothing
//   --yes           don't ask for confirmation
import {
  MIN_SOAK_HOURS,
  RING1_PREFIX,
  RING2_PREFIX,
  formatHours,
  localDateStamp,
  newestTag,
  nextTagName,
  parseFlags,
  releaseLogLine,
  soakStatus,
} from './lib'
import {
  SMOKE_CHECKLIST,
  checkTarget,
  confirm,
  createTag,
  deployTarget,
  describeTargets,
  fail,
  git,
  heading,
  headCommit,
  isAncestor,
  loadTargets,
  lockfileDiffers,
  migrationsBetween,
  pnpmInstall,
  requireCleanTree,
  requireMain,
  ringTags,
  runMain,
  shortSha,
} from './shell'

const HELP = `pnpm ring:promote [--tag ring1-YYYY-MM-DD] [--urgent] [--dry-run] [--yes]

Deploys the newest ring 1 release (or --tag) to every ring 2 deployment in
apps/nuxflow/release-targets.json: the exact commit ring 1 got, even if main has moved
on since. Refuses until it has run on ring 1 for ${MIN_SOAK_HOURS} hours, unless --urgent.`

runMain(async () => {
  const flags = parseFlags(process.argv.slice(2), ['dryRun', 'yes', 'urgent', 'tag'])
  if (flags.help) return console.log(HELP)

  const targets = loadTargets().filter(t => t.ring === 2)
  if (!targets.length) fail('release-targets.json has no ring 2 deployments, so there\'s nothing to promote to.')
  requireMain()
  requireCleanTree()

  const tags = ringTags()
  const release = flags.tag
    ? tags.find(t => t.name === flags.tag) ?? fail(`There's no tag called ${flags.tag}. See them with: pnpm ring:status`)
    : newestTag(tags, RING1_PREFIX) ?? fail('There\'s no ring 1 release yet. Run pnpm ring:canary first.')

  const now = new Date()
  const soak = soakStatus(release.createdAt, now)
  const current = newestTag(tags, RING2_PREFIX)
  const alreadyPromoted = tags.find(t => t.name.startsWith(RING2_PREFIX) && t.commit === release.commit)
  // Promoting a release older than what ring 2 already runs is a rollback.
  const rollback = !!current && current.commit !== release.commit && isAncestor(release.commit, current.commit)
  const migrations = current && !rollback ? migrationsBetween(current.commit, release.commit) : null

  heading('Promote to ring 2')
  console.log(`Release:  ${release.name} (commit ${shortSha(release.commit)})`)
  console.log(`On ring 1 for: ${formatHours(soak.hoursWaited)}`)
  console.log(`Ring 2 now runs: ${current ? `${current.name} (commit ${shortSha(current.commit)})` : 'unknown (first promotion)'}`)
  console.log(`Deploy:\n${describeTargets(targets)}`)
  if (rollback) {
    console.log(`\n⚠ ROLLBACK: ${release.name} is OLDER than what ring 2 runs now.`)
    console.log('  If anything between them changed the database, don\'t do this. Ask Claude for a forward fix instead.')
  } else if (migrations === null) {
    console.log('Database: no earlier ring 2 release to compare with.')
  } else if (migrations.length) {
    console.log(`Database: ⚠ CHANGES since ${current!.name}:\n${migrations.map(m => `  • ${m}`).join('\n')}`)
    console.log('          A rollback can\'t undo these.')
  } else {
    console.log(`Database: no changes since ${current!.name}.`)
  }
  if (alreadyPromoted && !rollback) console.log(`\nNote: this release was already promoted (${alreadyPromoted.name}). Deploying it again is harmless.`)

  if (!soak.ready) {
    if (!flags.urgent) {
      fail(`${release.name} has only been on ring 1 for ${formatHours(soak.hoursWaited)}. Wait ${formatHours(soak.hoursLeft)} more and keep using your own sites.\nFor an urgent security fix only: pnpm ring:promote --urgent`)
    }
    console.log(`\n⚠ --urgent: skipping the rest of the ${MIN_SOAK_HOURS}-hour wait.`)
  }

  if (flags.dryRun) {
    console.log('\nDry run: nothing was tagged or deployed.')
    return
  }
  await confirm(`Deploy ${release.name} to ring 2 (customers)?`, flags.yes)

  // Deploy the tagged commit itself, not whatever main is now. Gitignored files (wrangler
  // configs, release-targets.json, MYSTUFF) stay as they are while switching.
  const head = headCommit()
  const needSwitch = head !== release.commit
  const reinstall = needSwitch && lockfileDiffers(head, release.commit)
  let switched = false
  const restore = () => {
    if (!switched) return
    switched = false
    heading('Back to main')
    git(['switch', 'main'])
    if (reinstall) pnpmInstall('main\'s packages again', 'You\'re back on main, but its packages didn\'t reinstall. Run: pnpm install')
  }
  const onInterrupt = () => {
    console.log('\nInterrupted.')
    restore()
    process.exit(130)
  }
  process.on('SIGINT', onInterrupt)

  let failed: string[]
  try {
    if (needSwitch) {
      heading(`Switching to ${release.name}`)
      git(['switch', '--detach', release.name])
      switched = true
      if (reinstall) pnpmInstall('the packages this release uses', 'pnpm install failed for this release (see above), so nothing was deployed.')
    }
    failed = targets.filter(t => !deployTarget(t, { tag: release.name, commit: release.commit })).map(t => t.name)
  } finally {
    restore()
    process.off('SIGINT', onInterrupt)
  }

  if (failed.length) {
    fail(`Deploy failed for: ${failed.join(', ')} (see above). The others are done.\nFix the problem and run pnpm ring:promote again; it's safe to repeat.`)
  }

  const ring2Tag = alreadyPromoted?.name ?? nextTagName(RING2_PREFIX, now, tags.map(t => t.name))
  if (!alreadyPromoted) createTag(ring2Tag, `Ring 2 release ${localDateStamp(now)} (from ${release.name})`, release.commit)

  heading('Checks')
  for (const t of targets) console.log(await checkTarget(t))

  heading('Now check by hand (5 minutes)')
  for (const line of SMOKE_CHECKLIST) console.log(`  [ ] ${line}`)

  heading('For your release log (doc 14)')
  console.log(`Tick "promoted" on the ${release.name} row: ${ring2Tag}`)
  console.log(releaseLogLine({ date: release.createdAt, tag: release.name, dbChange: migrations ? migrations.length > 0 : null, promoted: ring2Tag }))
  console.log('\nDone.')
})
