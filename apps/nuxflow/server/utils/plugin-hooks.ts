// Event hooks: telling plugins when something happens on their site. A plugin receives a
// hook only for events it was granted (`hook:<event>` permission) and only while active.
//
// Delivery is a POST to the plugin's own fetch handler at `/__nuxflow/hooks/<event>` with
// a JSON body `{ event, occurredAt, data }` — a path the public /_nuxflow/ext route refuses,
// so only NuxFlow can deliver one. Always in the background (waitUntil): a slow or broken
// plugin never delays or fails the save/submission that triggered it, and a failed delivery
// is logged, not retried.
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { contentTypes, dynamicPlugins } from '@nuxflow/db/schema'
import { useDb } from './db'
import { waitUntil } from './cf-env'
import { itemPublicPath } from './public-page'
import { invokePlugin, RESERVED_PLUGIN_PATH_PREFIX } from './plugin-runtime'
import type { PluginHookEvent } from '../../shared/lib/plugin-permissions'
import { withTimeout } from './timeout'

const HOOK_TIMEOUT_MS = 15_000

type HookData = Record<string, unknown> | (() => Promise<Record<string, unknown>>)

/**
 * Delivers `hook` to every active plugin on the site granted it. `data` may be a function,
 * called only when at least one plugin is listening — so a site without hook plugins pays
 * one indexed query and nothing else. Returns how many plugins it was sent to.
 */
export async function dispatchPluginHook(event: H3Event, siteId: string, hook: PluginHookEvent, data: HookData): Promise<number> {
  const rows = await useDb(event).query.dynamicPlugins.findMany({
    where: and(eq(dynamicPlugins.siteId, siteId), eq(dynamicPlugins.isActive, true), eq(dynamicPlugins.hasServer, true)),
    columns: { id: true, siteId: true, serverChecksum: true, grantedPermissions: true },
  })
  const targets = rows.filter(r => r.grantedPermissions?.includes(`hook:${hook}`))
  if (targets.length === 0) return 0

  const payload = typeof data === 'function' ? await data() : data
  const body = JSON.stringify({ event: hook, occurredAt: new Date().toISOString(), data: payload })
  const results = await Promise.allSettled(targets.map(async (plugin) => {
    const request = new Request(`https://plugin.internal${RESERVED_PLUGIN_PATH_PREFIX}/hooks/${hook}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nuxflow-hook': hook },
      body,
    })
    const res = await withTimeout(invokePlugin(event, plugin, request), HOOK_TIMEOUT_MS, `timed out after ${HOOK_TIMEOUT_MS / 1000}s`)
    if (!res.ok) throw new Error(`answered ${res.status}`)
    await res.body?.cancel()
  }))
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[plugin-hooks] ${hook} → ${targets[i]!.id} on site ${siteId} failed:`, r.reason)
  })
  return targets.length
}

/** Fire-and-forget delivery that outlives the response (waitUntil). */
export function queuePluginHook(event: H3Event, siteId: string, hook: PluginHookEvent, data: HookData): void {
  waitUntil(event, dispatchPluginHook(event, siteId, hook, data)
    .catch(err => console.error(`[plugin-hooks] ${hook} dispatch failed:`, err)))
}

interface ContentState {
  status: string
  visibility: string
}

export interface ContentHookItem {
  id: string
  typeId: string
  title: string
  slug: string
  locale?: string | null
  sourceItemId?: string | null
  publishedAt?: string | null
}

const isPublic = (s: ContentState | null): boolean => s?.status === 'published' && s.visibility === 'public'

/**
 * Which content hook (if any) a change from `before` to `after` is. Only public items
 * produce hooks — a members-only or draft item's title must not reach a plugin that was
 * only trusted with what visitors can see. `null` = didn't exist / no longer exists.
 */
export function contentHookFor(before: ContentState | null, after: ContentState | null): PluginHookEvent | null {
  if (!isPublic(before) && isPublic(after)) return 'content.published'
  if (isPublic(before) && isPublic(after)) return 'content.updated'
  if (isPublic(before) && !isPublic(after)) return 'content.unpublished'
  return null
}

/** The data a content hook carries — only what a visitor could see on the public page. */
function contentHookData(event: H3Event, siteId: string, item: ContentHookItem, deleted: boolean) {
  return async () => {
    const db = useDb(event)
    const [path, type] = await Promise.all([
      itemPublicPath(db, siteId, item),
      db.query.contentTypes.findFirst({ where: and(eq(contentTypes.id, item.typeId), eq(contentTypes.siteId, siteId)), columns: { slug: true } }),
    ])
    return {
      id: item.id,
      type: type?.slug ?? null,
      title: item.title,
      slug: item.slug,
      path,
      locale: item.locale ?? null,
      publishedAt: item.publishedAt ?? null,
      ...(deleted ? { deleted: true } : {}),
    }
  }
}

/** Queues the content hook for a change, if it produces one. */
export function queueContentHook(event: H3Event, siteId: string, before: ContentState | null, after: ContentState | null, item: ContentHookItem): void {
  const hook = contentHookFor(before, after)
  if (hook) queuePluginHook(event, siteId, hook, contentHookData(event, siteId, item, after === null))
}

/** Like queueContentHook, awaited — for scheduled tasks, which already run in waitUntil. */
export async function dispatchContentHook(event: H3Event, siteId: string, before: ContentState | null, after: ContentState | null, item: ContentHookItem): Promise<void> {
  const hook = contentHookFor(before, after)
  if (hook) await dispatchPluginHook(event, siteId, hook, contentHookData(event, siteId, item, after === null))
}
