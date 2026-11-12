// ── Class passes and the shop switch ─────────────────────────────────────────
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { classPasses, siteSettings } from '@nuxflow/db/schema'
import type { Db } from '../db'
import { saveSetting, resolveBooleanSetting } from '../settings'
import { planIncludes } from '../hosting-plans'
import { ensureShopContent, SHOP_ENABLED_KEY } from '../shop'
import { addRestoreWarning } from '../backup-types'
import type { NuxFlowBackup, RestoreOptions, RestoreResult } from '../backup-types'

/**
 * Class passes, matched by name like membership tiers (they're restored with them). What
 * people bought (`class_pass_holdings`) never travels: those are people's purchases.
 */
export async function restoreClassPasses(
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('membershipTiers') || !backup.classPasses?.length) return
  const counts = { created: 0, updated: 0, skipped: 0 }
  const existing = await db.query.classPasses.findMany({ where: eq(classPasses.siteId, siteId), columns: { id: true, name: true } })
  const byName = new Map(existing.map(p => [p.name, p.id]))
  for (const pass of backup.classPasses) {
    const values = {
      description: pass.description,
      credits: pass.credits,
      price: pass.price,
      currency: pass.currency.toUpperCase(),
      validDays: pass.validDays,
      isActive: pass.isActive,
    }
    const id = byName.get(pass.name)
    if (id) {
      if (opts.conflictMode === 'overwrite') {
        await db.update(classPasses).set({ ...values, updatedAt: new Date().toISOString() })
          .where(and(eq(classPasses.id, id), eq(classPasses.siteId, siteId)))
        counts.updated++
      }
      else {
        counts.skipped++
      }
      continue
    }
    const newId = ulid()
    await db.insert(classPasses).values({ id: newId, siteId, name: pass.name, ...values })
    byName.set(pass.name, newId)
    counts.created++
  }
  result.classPasses = counts
}

/**
 * Switches the shop on when the backup's was. `shop.enabled` is server-managed — turning it
 * on needs the plan to include the shop, and makes the product type and collections — so it
 * isn't in `settings`; it follows the same keep/replace choice as the settings, though.
 */
export async function restoreShopSwitch(
  event: H3Event,
  db: Db,
  siteId: string,
  backup: NuxFlowBackup,
  opts: RestoreOptions,
  result: RestoreResult,
): Promise<void> {
  if (!opts.what.includes('settings') || !backup.shop?.enabled) return
  if (opts.settingsGroups && !opts.settingsGroups.includes('other')) return
  if (await resolveBooleanSetting(event, SHOP_ENABLED_KEY)) return
  const replace = opts.settingsMode ? opts.settingsMode === 'replace' : opts.conflictMode === 'overwrite'
  const stored = await db.query.siteSettings.findFirst({
    where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, SHOP_ENABLED_KEY)),
    columns: { id: true },
  })
  if (stored && !replace) return
  if (!(await planIncludes(db, siteId, 'shop'))) {
    addRestoreWarning(result, 'The backup\'s shop was switched on, but this site\'s plan doesn\'t include a shop, so it stays off.')
    return
  }
  await ensureShopContent(db, siteId)
  await saveSetting(event, SHOP_ENABLED_KEY, true)
}
