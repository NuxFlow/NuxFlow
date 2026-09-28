import type { H3Event } from 'h3'
import { getActiveProvider } from './index'
import { eventForSite } from '../site-info'

/**
 * Every storage key NuxFlow writes is `<siteId>/…` (upload, AI image, WordPress import,
 * restore, theme assets, inbound email, migration). The R2 bucket — and any S3/Bunny/
 * Cloudflare Images account shared through deployment env vars — holds every tenant's
 * files side by side, so a key outside the caller's own prefix is never something this
 * site may touch. Enforced at the delete chokepoint below rather than trusted from the
 * media row, since rows can be written from user-editable input (a restored backup).
 */
export function isSiteStorageKey(siteId: string, key: string): boolean {
  if (!key.startsWith(`${siteId}/`)) return false
  return !key.split('/').some(seg => seg === '' || seg === '.' || seg === '..')
}

/**
 * Removes a media row's stored bytes. `local` rows keep their bytes in the D1 row itself,
 * so there's nothing to delete remotely. Otherwise the delete goes to the provider the row
 * says it lives on — not blindly to whichever provider is active now — and only for a key
 * inside this site's own prefix.
 *
 * Returns false when the file can't be reached (it lives on a provider this site no longer
 * has configured, or its key isn't this site's to touch); the caller decides whether
 * that's fatal. Provider errors still throw.
 */
export async function deleteStoredMedia(
  event: H3Event,
  siteId: string,
  file: { storageKey: string; storageProvider: string },
): Promise<boolean> {
  if (file.storageProvider === 'local') return true
  if (!isSiteStorageKey(siteId, file.storageKey)) {
    // Never forwarded to the provider. Reported as unreachable rather than thrown, so the
    // bogus row itself can still be removed.
    console.warn(`[media] Refusing to delete storage key outside site ${siteId}: ${file.storageKey}`)
    return false
  }
  const provider = await getActiveProvider(eventForSite(event, siteId))
  if (provider.name !== file.storageProvider) return false
  await provider.delete(file.storageKey)
  return true
}

