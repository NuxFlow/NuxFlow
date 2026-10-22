// Release rings — everything that touches the outside world: git, wrangler, the targets
// file, the live sites, and the terminal. The decisions are in lib.ts.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  MIGRATIONS_DIR,
  TAG_LIST_FORMAT,
  TARGETS_FILE,
  migrationFiles,
  parseTagList,
  parseTargets,
  type ReleaseTarget,
  type RingTag,
} from './lib'

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const REPO_ROOT = resolve(APP_DIR, '../..')

const isWindows = process.platform === 'win32'

/** Stops the script with a plain message (no stack trace). */
export class ReleaseError extends Error {}

export function fail(message: string): never {
  throw new ReleaseError(message)
}

/**
 * Runs a script's main(), printing failures as a plain message. The errors lib.ts throws
 * (bad options, a broken targets file) are written for the operator too; a stack trace is
 * only shown with RELEASE_DEBUG=1.
 */
export function runMain(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    const debug = process.env.RELEASE_DEBUG === '1' && err instanceof Error && !(err instanceof ReleaseError)
    console.error(`\n✖ ${debug ? err.stack : err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}

export function heading(text: string): void {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 60 - text.length))}`)
}

// ── Commands ──────────────────────────────────────────────────────────────────────────

function capture(cmd: string, args: string[], cwd = REPO_ROOT): { ok: boolean; out: string; err: string } {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  if (res.error) fail(`Couldn't run ${cmd}: ${res.error.message}`)
  return { ok: res.status === 0, out: res.stdout.trim(), err: res.stderr.trim() }
}

// Every argument these scripts pass: flags, file names, tag names, commit hashes.
const PLAIN_ARG_RE = /^[\w.:@/=-]+$/

/**
 * Runs a command with its output shown live. pnpm is a .cmd shim on Windows, which Node
 * only starts through a shell, so there the command line is built by hand — from
 * arguments checked to need no quoting.
 */
function live(cmd: string, args: string[], cwd: string): boolean {
  const viaShell = isWindows && cmd === 'pnpm'
  if (viaShell) {
    const unsafe = args.find(a => !PLAIN_ARG_RE.test(a))
    if (unsafe !== undefined) fail(`Refusing to pass "${unsafe}" to ${cmd} through the shell.`)
  }
  const res = viaShell
    ? spawnSync([cmd, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (res.error) fail(`Couldn't run ${cmd}: ${res.error.message}`)
  return res.status === 0
}

export function git(args: string[]): string {
  const res = capture('git', args)
  if (!res.ok) fail(`git ${args.join(' ')} failed:\n${res.err || res.out}`)
  return res.out
}

export function gitSucceeds(args: string[]): boolean {
  return capture('git', args).ok
}

// ── Git state ─────────────────────────────────────────────────────────────────────────

export function currentBranch(): string {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function headCommit(): string {
  return git(['rev-parse', 'HEAD'])
}

/** Refuses to go on with uncommitted or untracked files (gitignored ones don't count). */
export function requireCleanTree(): void {
  const status = git(['status', '--porcelain'])
  if (status) {
    fail(`There are changes that aren't committed:\n${status}\n\nCommit them, or ask Claude, before releasing.`)
  }
}

export function requireMain(): void {
  const branch = currentBranch()
  if (branch !== 'main') fail(`You're on "${branch}", not main. Run: git switch main`)
}

/** HEAD must be exactly what's on GitHub's main: not behind it, and nothing unpushed. */
export function requireUpToDateWithOrigin(): void {
  console.log('Checking GitHub for newer code...')
  git(['fetch', 'origin', 'main', '--quiet'])
  const head = headCommit()
  const remote = git(['rev-parse', 'origin/main'])
  if (head === remote) return
  if (gitSucceeds(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])) {
    fail('Your main is behind GitHub. Run: git pull')
  }
  fail('Your main has commits that aren\'t on GitHub. Only merged, pushed code is released — push or open a PR first, or ask Claude.')
}

export function ringTags(): RingTag[] {
  return parseTagList(git(['for-each-ref', `--format=${TAG_LIST_FORMAT}`, 'refs/tags/ring1-*', 'refs/tags/ring2-*']))
}

export function createTag(name: string, message: string, commit = 'HEAD'): void {
  git(['tag', '-a', name, '-m', message, commit])
}

/** Migration files that differ between two commits. */
export function migrationsBetween(from: string, to: string): string[] {
  return migrationFiles(git(['diff', '--name-only', from, to, '--', MIGRATIONS_DIR]))
}

export function isAncestor(older: string, newer: string): boolean {
  return gitSucceeds(['merge-base', '--is-ancestor', older, newer])
}

export function commitsBetween(from: string, to: string): number {
  return Number(git(['rev-list', '--count', `${from}..${to}`])) || 0
}

export function lockfileDiffers(a: string, b: string): boolean {
  return !gitSucceeds(['diff', '--quiet', a, b, '--', 'pnpm-lock.yaml'])
}

export function shortSha(commit: string): string {
  return commit.slice(0, 7)
}

// ── Targets ───────────────────────────────────────────────────────────────────────────

export function loadTargets(): ReleaseTarget[] {
  const file = join(APP_DIR, TARGETS_FILE)
  if (!existsSync(file)) {
    fail(`apps/nuxflow/${TARGETS_FILE} doesn't exist yet. Copy release-targets.example.json to ${TARGETS_FILE} and list your deployments in it.`)
  }
  try {
    return parseTargets(readFileSync(file, 'utf8'), name => existsSync(join(APP_DIR, name)))
  } catch (err) {
    fail((err as Error).message)
  }
}

export function describeTargets(targets: readonly ReleaseTarget[]): string {
  return targets.map(t => `  • ${t.name}  (${t.config})`).join('\n')
}

// ── Deploying ─────────────────────────────────────────────────────────────────────────

/**
 * `wrangler deploy` for one target, recording the release in the Worker (shown on Super
 * Admin → Platform) and on the Cloudflare version (tag + message, seen when rolling back).
 */
export function deployTarget(target: ReleaseTarget, release: { tag: string; commit: string }): boolean {
  heading(`Deploying ${target.name}`)
  return live('pnpm', [
    'exec', 'wrangler', 'deploy',
    '--config', target.config,
    '--var', `NUXT_BUILD_COMMIT:${release.commit}`,
    '--var', `NUXT_BUILD_RELEASE:${release.tag}`,
    '--tag', release.tag,
    '--message', `${release.tag}@${shortSha(release.commit)}`,
  ], APP_DIR)
}

export function pnpmInstall(what: string, onFailure: string): void {
  heading(`Installing ${what}`)
  if (!live('pnpm', ['install', '--frozen-lockfile'], REPO_ROOT)) fail(onFailure)
}

/**
 * Loads a target's check page a few times and reports what happened. Never fails the
 * release: it's a hint for the manual smoke check, not a gate.
 */
export async function checkTarget(target: ReleaseTarget): Promise<string> {
  if (!target.checkUrl) return `${target.name}: no checkUrl in ${TARGETS_FILE}, check it by hand`
  let lastCache = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(target.checkUrl, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
      await res.arrayBuffer()
      if (!res.ok) return `✖ ${target.name}: ${target.checkUrl} answered ${res.status}`
      lastCache = res.headers.get('x-nuxflow-page-cache') ?? 'no header'
      if (lastCache === 'HIT') return `✔ ${target.name}: loads, page cache HIT`
    } catch (err) {
      return `✖ ${target.name}: couldn't load ${target.checkUrl} (${(err as Error).message})`
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  return `? ${target.name}: loads, but page cache says "${lastCache}" (expected HIT on a public page). Check by hand.`
}

// ── Terminal ──────────────────────────────────────────────────────────────────────────

/** Asks the operator to type "yes". --yes skips it; a non-interactive run without it refuses. */
export async function confirm(question: string, skip: boolean): Promise<void> {
  if (skip) return
  if (!process.stdin.isTTY) fail('Nobody is here to answer the question. Run it in a terminal, or add --yes.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`\n${question} Type yes to go ahead: `)).trim().toLowerCase()
    if (answer !== 'yes') fail('Stopped. Nothing was changed.')
  } finally {
    rl.close()
  }
}

export const SMOKE_CHECKLIST = [
  'Open each site above: pages load.',
  'Sign in to one site\'s admin. Edit a page, save, publish.',
  'Cloudflare → Workers & Pages → (each Worker) → Observability: no new burst of errors.',
]
