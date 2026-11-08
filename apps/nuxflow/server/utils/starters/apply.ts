// Applies a starter site's content, settings and theme to a site — the last step of every
// starter install, built-in or from the catalog (install.ts). Content goes through the same
// restore code as a backup (applyBackup), limited to the parts a starter may carry.
import type { H3Event } from 'h3'
import { and, eq, inArray, like } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentItems, contentTypes, menus, siteSettings, themes } from '@nuxflow/db/schema'
import { useDb, type Db } from '../db'
import { applyBackup, type NuxFlowBackup, type RestoreResult } from '../backup'
import { saveSetting } from '../settings'
import { SEO_SETTING_SCHEMAS } from '../seo-settings-schema'
import { clearSeoSettingsCache } from '../seo'
import { putThemeCSS } from '../cf-theme-kv'
import { clearActiveThemeCache } from '../theme-cache'
import { purgeAllPublicPages } from '../edge-cache'
import { waitUntil } from '../cf-env'
import { writeAuditLog } from '../audit'
import {
  planStarterSettings,
  settingFingerprint,
  starterSettingKind,
  type AppliedStarter,
} from '../../../shared/lib/starters'
import type { StarterContent } from './builtin'

export const APPLIED_STARTER_SETTING = 'starters.applied'
/** Themes a starter installs are recognisable by this package-name prefix. */
export const STARTER_THEME_PREFIX = '@starter/'

export interface ApplyStarterInput {
  siteId: string
  userId: string | null
  starter: { id: string; name: string; version: string }
  content: StarterContent
  css: string | null
  /**
   * 'fresh': a new site's placeholder pages are replaced in place.
   * 'switch': the site's current pages and posts are kept as drafts (same-address ones are
   * renamed "(Backup — …)"), and the starter's go live.
   */
  mode: 'fresh' | 'switch'
}

export interface ApplyStarterResult {
  content: RestoreResult['content']
  menus: number
  forms: number
  draftedItems: number
  settingsWritten: number
  /** Settings the starter has that the site's own value was kept for. */
  settingsKept: string[]
  planLimits: RestoreResult['planLimits']
}

/** Turns a starter's content into the backup shape applyBackup() reads. */
export function starterBackup(content: StarterContent, siteName: string): NuxFlowBackup {
  return {
    version: '1',
    exportedAt: new Date().toISOString(),
    site: { name: siteName, locale: 'en', timezone: 'UTC' },
    settings: {},
    contentTypes: content.contentTypes ?? [],
    content: content.content,
    taxonomies: content.taxonomies ?? [],
    menus: content.menus ?? [],
    forms: content.forms ?? [],
    media: [],
    themes: [],
    plugins: [],
    users: [],
    membershipTiers: [],
    redirects: [],
  }
}

/**
 * Before a switch: the site's published pages and posts become drafts (nothing is deleted),
 * except a privacy page the starter doesn't replace — the cookie banner links to it. Menus
 * at a position the starter fills give it up, so the starter's menu shows there.
 */
async function keepOldContentAsDrafts(db: Db, siteId: string, content: StarterContent): Promise<number> {
  const types = await db.query.contentTypes.findMany({
    where: and(eq(contentTypes.siteId, siteId), inArray(contentTypes.slug, ['page', 'post'])),
    columns: { id: true },
  })
  let drafted = 0
  if (types.length > 0) {
    const starterSlugs = new Set(content.content.map(c => c.slug))
    const keep = starterSlugs.has('privacy') ? [] : ['privacy']
    const rows = await db.query.contentItems.findMany({
      where: and(
        eq(contentItems.siteId, siteId),
        inArray(contentItems.typeId, types.map(t => t.id)),
        inArray(contentItems.status, ['published', 'scheduled']),
      ),
      columns: { id: true, slug: true },
    })
    const ids = rows.filter(r => !keep.includes(r.slug)).map(r => r.id)
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      await db.update(contentItems).set({ status: 'draft' })
        .where(and(eq(contentItems.siteId, siteId), inArray(contentItems.id, chunk)))
    }
    drafted = ids.length
  }

  const locations = [...new Set((content.menus ?? []).map(m => m.location).filter((l): l is string => !!l))]
  if (locations.length > 0) {
    await db.update(menus).set({ location: null })
      .where(and(eq(menus.siteId, siteId), inArray(menus.location, locations)))
  }
  return drafted
}

async function readAppliedStarter(db: Db, siteId: string): Promise<AppliedStarter | null> {
  const row = await db.query.siteSettings.findFirst({
    where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, APPLIED_STARTER_SETTING)),
    columns: { value: true },
  })
  const v = row?.value as AppliedStarter | undefined
  return v && typeof v === 'object' && typeof v.id === 'string' ? v : null
}

async function applyStarterSettings(
  event: H3Event,
  db: Db,
  siteId: string,
  settings: Record<string, unknown>,
  previous: AppliedStarter | null,
): Promise<{ written: Record<string, string>; kept: string[] }> {
  const previousSettings = previous?.settings ?? {}
  const keys = [...new Set([...Object.keys(settings), ...Object.keys(previousSettings)])]
    .filter(k => starterSettingKind(k) !== null)
  const rows = keys.length > 0
    ? await db.query.siteSettings.findMany({
        where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, keys)),
        columns: { key: true, value: true },
      })
    : []
  const current = new Map(rows.map(r => [r.key, settingFingerprint(r.value)]))
  const plan = planStarterSettings(settings, current, previousSettings, settingFingerprint)

  const written: Record<string, string> = {}
  let touchedSeo = false
  for (const [key, raw] of plan.write) {
    let value = raw
    if (key.startsWith('seo.')) {
      const parsed = SEO_SETTING_SCHEMAS[key]?.safeParse(raw)
      if (!parsed?.success) continue
      value = parsed.data
      touchedSeo = true
    }
    await saveSetting(event, key, value)
    written[key] = settingFingerprint(value)
  }
  for (const key of plan.clear) {
    await saveSetting(event, key, null)
    if (key.startsWith('seo.')) touchedSeo = true
  }
  if (touchedSeo) clearSeoSettingsCache(siteId)
  return { written, kept: plan.kept }
}

/**
 * A starter with CSS installs (or updates) its own theme and makes it active. One without
 * CSS switches off a theme an earlier starter installed, so the site goes back to the
 * default look rather than keeping the old starter's — a theme the owner installed
 * themselves stays.
 */
async function applyStarterTheme(event: H3Event, db: Db, siteId: string, starter: ApplyStarterInput['starter'], css: string | null): Promise<void> {
  const packageName = `${STARTER_THEME_PREFIX}${starter.id}`
  if (css) {
    const existing = await db.query.themes.findFirst({
      where: and(eq(themes.siteId, siteId), eq(themes.packageName, packageName)),
      columns: { id: true },
    })
    const themeId = existing?.id ?? ulid()
    if (existing) {
      await db.update(themes).set({ name: starter.name, version: starter.version, hasCss: true })
        .where(and(eq(themes.id, themeId), eq(themes.siteId, siteId)))
    } else {
      await db.insert(themes).values({ id: themeId, siteId, packageName, name: starter.name, version: starter.version, isActive: false, hasCss: true })
    }
    await putThemeCSS(event, siteId, themeId, css)
    await db.batch([
      db.update(themes).set({ isActive: false }).where(eq(themes.siteId, siteId)),
      db.update(themes).set({ isActive: true }).where(and(eq(themes.id, themeId), eq(themes.siteId, siteId))),
    ])
  } else {
    await db.update(themes).set({ isActive: false })
      .where(and(eq(themes.siteId, siteId), eq(themes.isActive, true), like(themes.packageName, `${STARTER_THEME_PREFIX}%`)))
  }
  await clearActiveThemeCache(event, siteId)
}

export async function applyStarter(event: H3Event, input: ApplyStarterInput): Promise<ApplyStarterResult> {
  const db = useDb(event)
  const { siteId, content, mode } = input
  const site = await db.query.sites.findFirst({ where: (s, { eq }) => eq(s.id, siteId), columns: { name: true } })

  const draftedItems = mode === 'switch' ? await keepOldContentAsDrafts(db, siteId, content) : 0

  const restored = await applyBackup(event, siteId, starterBackup(content, site?.name ?? ''), {
    what: ['content', 'taxonomies', 'menus', 'forms'],
    conflictMode: mode === 'fresh' ? 'overwrite' : 'archive',
    authorId: input.userId ?? undefined,
  })

  const previous = await readAppliedStarter(db, siteId)
  const settings = await applyStarterSettings(event, db, siteId, content.settings ?? {}, previous)
  await applyStarterTheme(event, db, siteId, input.starter, input.css)

  const applied: AppliedStarter = {
    id: input.starter.id,
    name: input.starter.name,
    version: input.starter.version,
    at: new Date().toISOString(),
    settings: settings.written,
  }
  await saveSetting(event, APPLIED_STARTER_SETTING, applied)

  await writeAuditLog(event, input.userId, {
    action: 'apply',
    resource: 'starter',
    resourceId: input.starter.id,
    after: { name: input.starter.name, version: input.starter.version, mode, draftedItems },
  })

  waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
    console.error('[starters] Failed to purge page cache after installing a starter:', err)
  }))

  return {
    content: restored.content,
    menus: restored.menus.created,
    forms: restored.forms.created,
    draftedItems,
    settingsWritten: Object.keys(settings.written).length,
    settingsKept: settings.kept,
    planLimits: restored.planLimits,
  }
}
