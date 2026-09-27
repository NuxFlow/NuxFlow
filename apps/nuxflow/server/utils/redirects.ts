import { z } from 'zod'
import { redirects } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { ulid } from 'ulid'
import type { Db } from './db'
import { clearRedirectCache, normalizeRedirectPath } from './redirect-cache'

export const REDIRECT_STATUS_CODES = [301, 302, 307, 308, 410] as const
export type RedirectStatus = typeof REDIRECT_STATUS_CODES[number]

/**
 * Validation shared by create, edit, and import. `to` may be a site path (`/new`) or an
 * absolute http(s) URL; a 410 (Gone) rule has no target.
 */
export const redirectRuleSchema = z.object({
  from: z.string().trim().min(1).max(2048).startsWith('/'),
  to: z.string().trim().max(2048).default(''),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308), z.literal(410)]).default(301),
}).superRefine((rule, ctx) => {
  if (rule.statusCode === 410) return
  if (!rule.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'A destination is required (or use 410 Gone)' })
    return
  }
  if (!rule.to.startsWith('/') && !/^https?:\/\//i.test(rule.to)) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Destination must be a site path starting with / or an http(s) URL' })
    return
  }
  if (rule.to.startsWith('/') && normalizeRedirectPath(rule.to) === normalizeRedirectPath(rule.from)) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'A redirect cannot point to itself' })
  }
})

export type RedirectRule = z.infer<typeof redirectRuleSchema>

export interface SavedRedirect { id: string; from: string; to: string; statusCode: number; action: 'created' | 'updated' | 'unchanged' }

/**
 * Creates or updates the rule for `from` (one rule per normalized path) and keeps the
 * table free of chains: any existing rule that pointed at this rule's `from` is repointed
 * straight to its new destination (A→B plus B→C becomes A→C, B→C — one hop for crawlers
 * instead of two), and a rule whose `from` is this rule's destination is removed, since it
 * would otherwise bounce visitors straight back out of the page they were sent to.
 */
export async function saveRedirect(db: Db, siteId: string, rule: RedirectRule, opts: { overwrite: boolean }): Promise<SavedRedirect> {
  const from = normalizeRedirectPath(rule.from)
  const to = rule.statusCode === 410 ? '' : rule.to

  const all = await db.query.redirects.findMany({
    where: eq(redirects.siteId, siteId),
    columns: { id: true, from: true, to: true, statusCode: true },
  })
  const existing = all.find(r => normalizeRedirectPath(r.from) === from)

  if (existing && !opts.overwrite) {
    return { ...existing, action: 'unchanged' }
  }

  const statements: BatchItem<'sqlite'>[] = []
  let id: string
  let action: SavedRedirect['action']
  if (existing) {
    id = existing.id
    action = existing.to === to && existing.statusCode === rule.statusCode ? 'unchanged' : 'updated'
    statements.push(db.update(redirects).set({ from, to, statusCode: rule.statusCode }).where(and(eq(redirects.id, id), eq(redirects.siteId, siteId))))
  } else {
    id = ulid()
    action = 'created'
    statements.push(db.insert(redirects).values({ id, siteId, from, to, statusCode: rule.statusCode }))
  }

  if (to.startsWith('/')) {
    // Flatten chains that now end at this rule's source.
    const pointingHere = all.filter(r => r.id !== id && r.to.startsWith('/') && normalizeRedirectPath(r.to) === from)
    for (const r of pointingHere) {
      if (normalizeRedirectPath(r.from) === normalizeRedirectPath(to)) {
        // B→A while adding A→B: the old rule would loop; the newer intent wins.
        statements.push(db.delete(redirects).where(and(eq(redirects.id, r.id), eq(redirects.siteId, siteId))))
      } else {
        statements.push(db.update(redirects).set({ to }).where(and(eq(redirects.id, r.id), eq(redirects.siteId, siteId))))
      }
    }
  }

  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
  clearRedirectCache(siteId)
  return { id, from, to, statusCode: rule.statusCode, action }
}

/**
 * Called when a published item's URL changes (slug edit): 301 each old public path to its
 * new one, and drop any rule on the new path so the page is actually reachable there
 * (e.g. an item renamed back to a slug it used to have).
 */
export async function redirectMovedPaths(db: Db, siteId: string, moves: { from: string; to: string }[]): Promise<void> {
  const real = moves.filter(m => m.from !== m.to && m.from !== '/')
  if (real.length === 0) return

  const newPaths = new Set(real.map(m => normalizeRedirectPath(m.to)))
  const blocking = (await db.query.redirects.findMany({
    where: eq(redirects.siteId, siteId),
    columns: { id: true, from: true },
  })).filter(r => newPaths.has(normalizeRedirectPath(r.from)))
  if (blocking.length) {
    await db.delete(redirects).where(and(eq(redirects.siteId, siteId), inArray(redirects.id, blocking.map(b => b.id))))
  }
  for (const m of real) {
    await saveRedirect(db, siteId, { from: m.from, to: m.to, statusCode: 301 }, { overwrite: true })
  }
  clearRedirectCache(siteId)
}

/**
 * Parses a CSV/TSV of `from,to[,status]` lines (a header row and blank/`#` lines are
 * skipped). Quoted fields are supported so destinations containing commas survive.
 */
export function parseRedirectCsv(text: string): { rules: { line: number; rule: unknown }[]; lineErrors: { line: number; message: string }[] } {
  const rules: { line: number; rule: unknown }[] = []
  const lineErrors: { line: number; message: string }[] = []
  const lines = text.split(/\r?\n/)

  lines.forEach((raw, idx) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const delimiter = line.includes('\t') ? '\t' : ','
    const cells: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
      } else if (ch === delimiter && !quoted) {
        cells.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    cells.push(cur.trim())

    const [from = '', to = '', status = ''] = cells
    if (idx === 0 && !from.startsWith('/')) return // header row
    const statusCode = status ? Number(status) : (to ? 301 : 410)
    if (status && !Number.isInteger(statusCode)) {
      lineErrors.push({ line: idx + 1, message: `Invalid status "${status}"` })
      return
    }
    rules.push({ line: idx + 1, rule: { from, to, statusCode } })
  })
  return { rules, lineErrors }
}
