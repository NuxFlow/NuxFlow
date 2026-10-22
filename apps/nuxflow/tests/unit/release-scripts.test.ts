import { describe, expect, it } from 'vitest'
import {
  TAG_LIST_FORMAT,
  formatHours,
  localDateStamp,
  migrationFiles,
  newestTag,
  nextTagName,
  parseFlags,
  parseTagList,
  parseTargets,
  releaseLogLine,
  soakStatus,
} from '../../scripts/release/lib'

const exists = () => true
const targetsJson = (targets: unknown[]) => JSON.stringify({ targets })

describe('parseTargets', () => {
  it('reads a valid file', () => {
    const targets = parseTargets(targetsJson([
      { name: 'nuxflow.dev', ring: 1, config: 'wrangler.toml', checkUrl: 'https://nuxflow.dev/' },
      { name: 'nuxflow.cloud', ring: 2, config: 'wrangler.cloud.toml' },
    ]), exists)
    expect(targets).toEqual([
      { name: 'nuxflow.dev', ring: 1, config: 'wrangler.toml', checkUrl: 'https://nuxflow.dev/' },
      { name: 'nuxflow.cloud', ring: 2, config: 'wrangler.cloud.toml', checkUrl: undefined },
    ])
  })

  it('explains broken JSON instead of throwing a parser stack', () => {
    expect(() => parseTargets('{ "targets": [', exists)).toThrow(/isn't valid JSON/)
  })

  it.each([
    [[], /at least one deployment/],
    [[{ ring: 1, config: 'wrangler.toml' }], /"name" is missing/],
    [[{ name: 'a', ring: 3, config: 'wrangler.toml' }], /"ring" must be 1 or 2/],
    [[{ name: 'a', ring: 1, config: '../secrets.toml' }], /"config" must be a wrangler file name/],
    [[{ name: 'a', ring: 1, config: 'wrangler.toml', checkUrl: 'nuxflow.dev' }], /"checkUrl" must start with https/],
    [[{ name: 'a', ring: 1, config: 'wrangler.toml' }, { name: 'a', ring: 2, config: 'wrangler.cloud.toml' }], /used twice/],
    [[{ name: 'a', ring: 2, config: 'wrangler.toml' }], /no ring 1 deployment/],
  ])('refuses %j', (targets, message) => {
    expect(() => parseTargets(targetsJson(targets), exists)).toThrow(message)
  })

  it('refuses a config file that does not exist', () => {
    expect(() => parseTargets(targetsJson([{ name: 'a', ring: 1, config: 'wrangler.typo.toml' }]), f => f === 'wrangler.toml'))
      .toThrow(/wrangler\.typo\.toml doesn't exist/)
  })
})

describe('tag names', () => {
  const day = new Date(2026, 9, 22, 23, 30)

  it('uses the local date', () => {
    expect(localDateStamp(day)).toBe('2026-10-22')
  })

  it('adds a number for a second release the same day', () => {
    expect(nextTagName('ring1-', day, [])).toBe('ring1-2026-10-22')
    expect(nextTagName('ring1-', day, ['ring1-2026-10-22'])).toBe('ring1-2026-10-22-2')
    expect(nextTagName('ring1-', day, ['ring1-2026-10-22', 'ring1-2026-10-22-2'])).toBe('ring1-2026-10-22-3')
    expect(nextTagName('ring2-', day, ['ring1-2026-10-22'])).toBe('ring2-2026-10-22')
  })
})

describe('parseTagList', () => {
  it('asks git for the fields it parses', () => {
    expect(TAG_LIST_FORMAT.split('%09')).toHaveLength(6)
  })

  it('reads annotated tags by their own date and plain tags by their commit date', () => {
    const output = [
      'ring1-2026-10-22\ttag\tc1c1c1\tt0t0t0\t1761130000\t',
      'ring1-2026-10-20\tcommit\t\tc0c0c0\t\t1760950000',
      'garbage line',
      '',
    ].join('\n')
    expect(parseTagList(output)).toEqual([
      { name: 'ring1-2026-10-22', commit: 'c1c1c1', createdAt: new Date(1761130000 * 1000) },
      { name: 'ring1-2026-10-20', commit: 'c0c0c0', createdAt: new Date(1760950000 * 1000) },
    ])
  })

  it('picks the newest tag with a prefix', () => {
    const tags = [
      { name: 'ring1-2026-10-20', commit: 'a', createdAt: new Date(1000) },
      { name: 'ring2-2026-10-25', commit: 'a', createdAt: new Date(5000) },
      { name: 'ring1-2026-10-22', commit: 'b', createdAt: new Date(3000) },
    ]
    expect(newestTag(tags, 'ring1-')?.name).toBe('ring1-2026-10-22')
    expect(newestTag(tags, 'ring2-')?.name).toBe('ring2-2026-10-25')
    expect(newestTag([], 'ring1-')).toBeNull()
  })
})

describe('soakStatus', () => {
  const tagged = new Date('2026-10-22T10:00:00Z')

  it('is not ready before 48 hours', () => {
    const s = soakStatus(tagged, new Date('2026-10-23T15:00:00Z'))
    expect(s.ready).toBe(false)
    expect(s.hoursWaited).toBe(29)
    expect(s.hoursLeft).toBe(19)
  })

  it('is ready at 48 hours', () => {
    expect(soakStatus(tagged, new Date('2026-10-24T10:00:00Z')).ready).toBe(true)
  })

  it('treats a tag dated in the future (clock skew) as just made', () => {
    expect(soakStatus(tagged, new Date('2026-10-22T09:00:00Z'))).toMatchObject({ ready: false, hoursWaited: 0, hoursLeft: 48 })
  })

  it('formats hours in plain words', () => {
    expect(formatHours(0.5)).toBe('less than an hour')
    expect(formatHours(1)).toBe('1 hour')
    expect(formatHours(19.9)).toBe('19 hours')
    expect(formatHours(24)).toBe('1 day')
    expect(formatHours(53)).toBe('2 days 5 hours')
  })
})

describe('migrationFiles', () => {
  it('lists only SQL migrations', () => {
    expect(migrationFiles([
      'packages/db/migrations/0002_pools.sql',
      'packages/db/migrations/meta/_journal.json',
      'packages/db/migrations/meta/0002_snapshot.json',
      '',
    ].join('\n'))).toEqual(['packages/db/migrations/0002_pools.sql'])
    expect(migrationFiles('')).toEqual([])
  })
})

describe('releaseLogLine', () => {
  it('matches the release log table in doc 14', () => {
    const date = new Date(2026, 9, 22)
    expect(releaseLogLine({ date, tag: 'ring1-2026-10-22', dbChange: true })).toBe('| 2026-10-22 | ring1-2026-10-22 | yes | | |')
    expect(releaseLogLine({ date, tag: 'ring1-2026-10-22', dbChange: null, promoted: 'ring2-2026-10-24' }))
      .toBe('| 2026-10-22 | ring1-2026-10-22 | ? | | ring2-2026-10-24 |')
  })
})

describe('parseFlags', () => {
  it('reads the allowed flags', () => {
    expect(parseFlags(['--urgent', '--tag', 'ring1-2026-10-22', '--yes'], ['urgent', 'tag', 'yes']))
      .toMatchObject({ urgent: true, yes: true, tag: 'ring1-2026-10-22', dryRun: false })
    expect(parseFlags(['--', '--tag=ring1-2026-10-22'], ['tag']).tag).toBe('ring1-2026-10-22')
    expect(parseFlags(['-h'], []).help).toBe(true)
  })

  it('refuses flags a command does not take, so a typo never silently does the wrong thing', () => {
    expect(() => parseFlags(['--urgent'], ['dryRun', 'yes'])).toThrow(/Unknown option: --urgent/)
    expect(() => parseFlags(['--dryrun'], ['dryRun'])).toThrow(/Unknown option/)
  })

  it('only accepts ring 1 tags for --tag', () => {
    expect(() => parseFlags(['--tag', 'ring2-2026-10-22'], ['tag'])).toThrow(/ring 1 tag/)
    expect(() => parseFlags(['--tag'], ['tag'])).toThrow(/ring 1 tag/)
  })
})
