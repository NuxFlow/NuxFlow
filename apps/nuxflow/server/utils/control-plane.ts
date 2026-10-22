import type { H3Event } from 'h3'
import { and, eq, sql } from 'drizzle-orm'
import { platformSettings, siteSettings, sites } from '@nuxflow/db/schema'
import type { Db } from './db'
import { decryptText, encryptText } from './encryption'
import { forbidden } from './response'

/**
 * Control plane and pools.
 *
 * Every NuxFlow Worker is one of two things:
 *
 * - **The control plane** — every install today: a single site, several sites, or a
 *   hosting platform. It owns accounts and sign-in, billing, hosting plans, and the
 *   platform settings (stored on its primary site). `NUXT_POOL_ID` is unset.
 * - **A member pool** — a hosting platform's extra Worker + D1 that only holds some of
 *   its customers' sites (`NUXT_POOL_ID` set, e.g. `clientx`). Accounts, billing and
 *   platform settings live on the control plane; the pool never creates sites, super
 *   admins or a first install of its own, and only serves addresses its sites own.
 *
 * Everything pool-specific is decided here, so the rest of the code asks
 * `isMemberPool()` / `getPlatformSetting()` instead of growing its own checks. With
 * `NUXT_POOL_ID` unset every function behaves exactly as an install always has.
 */

export { POOL_ID_RE } from '../../shared/lib/pool-id'

/** The pool this Worker is, or null on the control plane (every ordinary install). */
export function getPoolId(): string | null {
  const raw = String(useRuntimeConfig().poolId ?? '').trim()
  return raw || null
}

export function isMemberPool(): boolean {
  return getPoolId() !== null
}

/**
 * For actions only the control plane may take (creating sites, first-install setup,
 * granting super admin, platform settings, plans): refused in a member pool, where the
 * control plane does them and tells the pool.
 */
export function requireControlPlane(_event: H3Event): void {
  if (isMemberPool()) throw forbidden('This is managed from the hosting platform\'s control panel, not on this pool.')
}

// ── Platform settings ─────────────────────────────────────────────────────────────────

/**
 * The platform settings a member pool's sites need, and whether each is secret. On the
 * control plane they're settings of the primary site (Super Admin → Platform); a pool
 * keeps the copy its control plane sends in `platform_settings`. Anything platform-wide
 * that pool sites must read goes through getPlatformSetting() and is listed here.
 */
export const POOL_PLATFORM_SETTINGS = {
  'platform.ai_daily_credit_cap': { sensitive: false },
  'analytics.cf_api_token': { sensitive: true },
  'cloudflare.account_id': { sensitive: false },
} as const

export type PlatformSettingKey = keyof typeof POOL_PLATFORM_SETTINGS

function isPlatformSettingKey(key: string): key is PlatformSettingKey {
  return Object.hasOwn(POOL_PLATFORM_SETTINGS, key)
}

/**
 * A platform setting as a string, or null when unset. `envKey` names a runtimeConfig
 * fallback, as resolveSetting() takes — the deployment's own variable, used only when
 * nothing is stored.
 */
export async function getPlatformSetting(db: Db, key: PlatformSettingKey, envKey?: string): Promise<string | null> {
  let raw: string | null
  if (isMemberPool()) {
    const [row] = await db.select({ value: platformSettings.value }).from(platformSettings)
      .where(eq(platformSettings.key, key)).limit(1)
    raw = row?.value ?? null
  } else {
    const [row] = await db.select({ value: siteSettings.value }).from(siteSettings)
      .innerJoin(sites, eq(sites.id, siteSettings.siteId))
      .where(and(eq(sites.isPrimary, true), eq(siteSettings.key, key)))
      .limit(1)
    // No primary site (it was never set up) means no platform settings at all — not even
    // the env fallback, as before this helper existed.
    if (!row) return envKey && await hasPrimarySite(db) ? envFallback(envKey) : null
    raw = row.value == null ? null : String(row.value)
  }

  if (raw === null || raw === '') return envKey ? envFallback(envKey) : null
  if (!POOL_PLATFORM_SETTINGS[key].sensitive) return raw
  try {
    return await decryptText(raw, String(useRuntimeConfig().betterAuthSecret))
  } catch {
    // Stored before encryption was enforced (see resolveSetting); use it as is.
    return raw
  }
}

async function hasPrimarySite(db: Db): Promise<boolean> {
  const [row] = await db.select({ id: sites.id }).from(sites).where(eq(sites.isPrimary, true)).limit(1)
  return !!row
}

function envFallback(envKey: string): string | null {
  const value = String((useRuntimeConfig() as Record<string, unknown>)[envKey] ?? '').trim()
  return value || null
}

/**
 * Stores what the control plane sent a member pool (null or '' removes a setting).
 * Refuses keys that aren't platform settings, so a pool's table can only ever hold what
 * getPlatformSetting() reads.
 */
export async function storePlatformSettings(db: Db, entries: Record<string, string | null>): Promise<void> {
  const secret = String(useRuntimeConfig().betterAuthSecret)
  for (const [key, value] of Object.entries(entries)) {
    if (!isPlatformSettingKey(key)) throw new Error(`Not a platform setting: ${key}`)
    if (value === null || value === '') {
      await db.delete(platformSettings).where(eq(platformSettings.key, key))
      continue
    }
    const stored = POOL_PLATFORM_SETTINGS[key].sensitive ? await encryptText(value, secret) : value
    await db.insert(platformSettings).values({ key, value: stored })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: stored, updatedAt: sql`(datetime('now'))` } })
  }
}
