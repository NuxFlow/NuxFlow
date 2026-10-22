// pnpm ring:status — where each ring stands. Changes nothing. See docs/release-rings.md.
import { RING1_PREFIX, RING2_PREFIX, formatHours, newestTag, parseFlags, soakStatus, tagsWithPrefix } from './lib'
import {
  commitsBetween,
  currentBranch,
  describeTargets,
  heading,
  isAncestor,
  loadTargets,
  migrationsBetween,
  ringTags,
  runMain,
  shortSha,
} from './shell'

runMain(async () => {
  const flags = parseFlags(process.argv.slice(2), [])
  if (flags.help) return console.log('pnpm ring:status\n\nShows the ring 1 and ring 2 releases and what to do next. Changes nothing.')

  const targets = loadTargets()
  const tags = ringTags()
  const ring1 = newestTag(tags, RING1_PREFIX)
  const ring2 = newestTag(tags, RING2_PREFIX)

  heading('Deployments')
  console.log(`Ring 1:\n${describeTargets(targets.filter(t => t.ring === 1))}`)
  const ring2Targets = targets.filter(t => t.ring === 2)
  console.log(`Ring 2:\n${ring2Targets.length ? describeTargets(ring2Targets) : '  (none)'}`)

  heading('Releases')
  if (!ring1) {
    console.log('No ring 1 release yet.\n\nNext: pnpm ring:canary')
    return
  }
  const soak = soakStatus(ring1.createdAt, new Date())
  console.log(`Ring 1 runs: ${ring1.name} (commit ${shortSha(ring1.commit)}), for ${formatHours(soak.hoursWaited)}`)
  console.log(`Ring 2 runs: ${ring2 ? `${ring2.name} (commit ${shortSha(ring2.commit)})` : 'nothing promoted yet'}`)

  const promoted = !!ring2 && (ring2.commit === ring1.commit || isAncestor(ring1.commit, ring2.commit))
  if (currentBranch() === 'main') {
    const waiting = commitsBetween(ring1.commit, 'HEAD')
    if (waiting) console.log(`Main has ${waiting} commit(s) not released to ring 1 yet.`)
  }

  heading('Next')
  if (promoted) {
    console.log('Both rings run the same release. Next time there\'s new code: pnpm ring:canary')
    return
  }
  const migrations = ring2 ? migrationsBetween(ring2.commit, ring1.commit) : []
  if (migrations.length) console.log(`⚠ Promoting changes the database:\n${migrations.map(m => `  • ${m}`).join('\n')}\n`)
  if (soak.ready) {
    console.log(`${ring1.name} has run on ring 1 long enough. If your sites have been fine: pnpm ring:promote`)
  } else {
    console.log(`Wait ${formatHours(soak.hoursLeft)} more, using your own sites, then: pnpm ring:promote`)
  }
  const older = tagsWithPrefix(tags, RING1_PREFIX).length - 1
  if (older > 0) console.log(`\n(${older} earlier ring 1 release(s): git tag --list "ring1-*")`)
})
