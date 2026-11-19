import type { H3Event } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import {
  ASSISTANT_SETTINGS,
  effectiveAssistantValue,
  isAssistantSettingKey,
  normalizeAssistantSetting,
  describeAssistantValue,
  type AssistantSettingKey,
  type AssistantSettingValue,
} from '../../shared/lib/assistant'
import { useDb } from './db'
import { batchSaveSettings, resolveSetting } from './settings'
import { normalizeSeoSettings } from './seo-settings-schema'
import { clearSeoSettingsCache } from './seo'
import { clearAppearanceCache } from './appearance-cache'
import { clearSiteCache } from './site-resolution'
import { getSiteInfo } from './site-info'
import { writeAuditLog } from './audit'
import { aiAuditDetails, auditAction, type AiAssist } from './ai-provenance'
import { purgeEdgeCache, purgeAllPublicPages } from './edge-cache'
import { waitUntil } from './cf-env'

// Reading and saving the settings on the AI safe list (shared/lib/assistant.ts) outside the
// Settings page — used by the MCP settings tools, so an outside AI assistant can change
// exactly what the admin helper can suggest and nothing more. Does what PATCH
// /api/v1/settings does for these keys (none of which are secret, plan-gated or shared
// with pools): seo.* through the SEO schema, the caches those keys feed, an audit row and
// a purge of the public pages.

export interface AssistantSettingRow {
  key: AssistantSettingKey
  label: string
  value: AssistantSettingValue
  shown: string
}

export async function readAssistantSettings(event: H3Event, siteId: string): Promise<AssistantSettingRow[]> {
  const keys = Object.keys(ASSISTANT_SETTINGS) as AssistantSettingKey[]
  const site = await getSiteInfo(event, siteId)
  const stored = await Promise.all(keys.map(k => (k === 'site.name' ? Promise.resolve(site?.name) : resolveSetting(event, k))))
  return keys.map((key, i) => {
    const value = effectiveAssistantValue(key, stored[i])
    return { key, label: ASSISTANT_SETTINGS[key].label, value, shown: describeAssistantValue(key, value) }
  })
}

/** Checks every value first; returns the problems, or the cleaned values when there are none. */
export function checkAssistantSettings(input: Record<string, unknown>): { values: Partial<Record<AssistantSettingKey, AssistantSettingValue>> } | { problems: string[] } {
  const problems: string[] = []
  const values: Partial<Record<AssistantSettingKey, AssistantSettingValue>> = {}
  const entries = Object.entries(input)
  if (!entries.length) problems.push('No settings given')
  for (const [key, raw] of entries) {
    if (!isAssistantSettingKey(key)) {
      problems.push(`"${key}" can't be changed this way (allowed: ${Object.keys(ASSISTANT_SETTINGS).join(', ')})`)
      continue
    }
    const value = normalizeAssistantSetting(key, raw)
    if (value === undefined) problems.push(`${JSON.stringify(raw)} isn't a valid value for "${key}"`)
    else values[key] = value
  }
  return problems.length ? { problems } : { values }
}

/** Saves already-checked values; returns what each was before. */
export async function saveAssistantSettings(
  event: H3Event,
  opts: { siteId: string; userId: string; values: Partial<Record<AssistantSettingKey, AssistantSettingValue>>; aiAssist: AiAssist },
): Promise<Array<{ key: AssistantSettingKey; before: string; after: string }>> {
  const before = new Map((await readAssistantSettings(event, opts.siteId)).map(r => [r.key, r.value]))
  const entries = Object.entries(opts.values) as [AssistantSettingKey, AssistantSettingValue][]
  const db = useDb(event)

  const name = opts.values['site.name']
  if (typeof name === 'string') {
    await db.update(sites).set({ name, updatedAt: sql`(datetime('now'))` }).where(eq(sites.id, opts.siteId))
    clearSiteCache()
  }
  const settingEntries = normalizeSeoSettings(entries.filter(([k]) => k !== 'site.name'))
  if (settingEntries.length) await batchSaveSettings(event, settingEntries)
  if (settingEntries.some(([k]) => k.startsWith('seo.'))) clearSeoSettingsCache(opts.siteId)
  if (settingEntries.some(([k]) => k.startsWith('theme.'))) clearAppearanceCache(opts.siteId)

  const changes = entries.map(([key, value]) => ({
    key,
    before: describeAssistantValue(key, before.get(key)),
    after: describeAssistantValue(key, value),
  }))
  await writeAuditLog(event, opts.userId, {
    action: auditAction('update', opts.aiAssist),
    resource: 'settings',
    after: { keys: entries.map(([k]) => (k === 'site.name' ? 'name' : k)), ...aiAuditDetails({ ...opts.aiAssist, summary: opts.aiAssist.summary || changes.map(c => `${ASSISTANT_SETTINGS[c.key].label}: ${c.before} → ${c.after}`).join(' · ') }) },
  })

  await purgeEdgeCache(event, ['/api/public/site'])
  waitUntil(event, purgeAllPublicPages(event, opts.siteId).catch((err) => {
    console.error('[assistant-settings] Failed to purge page cache:', err)
  }))
  return changes
}
