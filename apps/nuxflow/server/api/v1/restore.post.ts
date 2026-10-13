import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireRole } from '../../utils/permissions'
import { applyBackup, parseBackupJson, rewriteImageUrls } from '../../utils/backup'
import type { NuxFlowBackup, RestoreOptions } from '../../utils/backup'
import { unzipSync } from 'fflate'
import { getActiveProvider } from '../../utils/media-providers/index'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from '../../utils/db'
import { validateZipArchive } from '../../utils/zip-validate'
import { isHttpError } from '../../utils/errors'
import { purgeAllPublicPages } from '../../utils/edge-cache'
import { waitUntil } from '../../utils/cf-env'
import { writeAuditLog } from '../../utils/audit'
import { rateLimit } from '../../utils/rate-limit'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

const querySchema = z.object({
  what: z.string().default('content,taxonomies,menus,forms,settings,site,redirects'),
  conflictMode: z.enum(['skip', 'overwrite', 'archive']).default('skip'),
})

// A .zip always starts with a "PK" local-file-header signature; anything else uploaded
// here is treated as a raw backup.json (the "content only" option the Restore UI offers
// alongside .zip — no bundled media, images keep pointing at their original site).
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B
}

export default defineEventHandler(async (event) => {
  // A restore can provision accounts and send set-password emails for every user it
  // names (up to MAX_BACKUP_USERS) — bound how often that can be repeated.
  await rateLimit(event, { limit: 5, windowMs: 60 * 60_000, keyPrefix: 'restore' })
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const query = await parseQuery(event, querySchema)

  const what = query.what.split(',').filter(
    (w): w is RestoreOptions['what'][number] =>
      ['content', 'taxonomies', 'menus', 'forms', 'settings', 'site', 'themes', 'plugins', 'users', 'membershipTiers', 'redirects'].includes(w),
  )

  const formData = await readMultipartFormData(event)
  const file = formData?.find(f => f.name === 'file')
  if (!file) throw badRequest('No file uploaded')

  if (file.data.byteLength > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, message: 'Backup file exceeds 100 MB limit' })
  }

  let backup: NuxFlowBackup
  // Decompresses one zip entry on demand. The archive is never unzipped as a whole: the
  // upload (up to 100 MB) plus every decompressed file at once didn't fit in a Worker's
  // 128 MB of memory. Stays a no-op for a raw .json upload — every backup.media entry then
  // has no matching zip entry below, so the media re-upload loop naturally skips all of
  // them (content-only: images keep referencing their original site's URLs).
  let readZipEntry: (path: string) => Uint8Array | undefined = () => undefined

  if (looksLikeZip(file.data)) {
    // Robustly validate the ZIP archive for Zip Slip (path traversal) and Zip Bomb (uncompressed size)
    validateZipArchive(file.data, MAX_UPLOAD_BYTES)

    const zipData = file.data
    // Entry paths are matched with forward slashes to support Windows-packaged ZIP archives.
    readZipEntry = (path) => {
      const out = unzipSync(zipData, { filter: entry => entry.name.replace(/\\/g, '/') === path })
      return Object.values(out)[0]
    }

    let backupFile: Uint8Array | undefined
    try {
      backupFile = readZipEntry('backup.json')
    } catch (e: unknown) {
      if (isHttpError(e)) throw e
      throw badRequest('Invalid zip file — upload a NuxFlow .zip or .json backup')
    }
    if (!backupFile) throw badRequest('backup.json not found in zip')

    backup = parseBackupJson(new TextDecoder().decode(backupFile))
  } else {
    backup = parseBackupJson(new TextDecoder().decode(file.data))
  }

  const mediaResult = { uploaded: 0, skipped: 0 }

  // Re-upload bundled images to the active media provider
  if (backup.media?.length && what.includes('content')) {
    const provider = await getActiveProvider(event)
    const urlMap = new Map<string, string>()

    // Dedup against media already on this site, keyed by (originalName, size) — the
    // closest thing to a content identity available without hashing file bytes.
    // Without this, restoring the same backup twice (a common disaster-recovery
    // drill, or retrying a restore that failed partway through downstream in
    // applyBackup()) silently duplicated every media item on every run, regardless of
    // conflictMode. 'skip'/'archive' leave the existing row alone (matching how every
    // other conflictMode==='archive' section in this file behaves — see the themes/
    // dynamicPlugins comments); 'overwrite' replaces the stored file and updates it.
    const existingMediaRows = await db.query.media.findMany({
      where: eq(media.siteId, siteId),
      columns: { id: true, originalName: true, size: true, url: true },
    })
    const existingByIdentity = new Map(
      existingMediaRows.map(m => [`${m.originalName}::${m.size}`, m]),
    )

    for (const item of backup.media) {
      const identityKey = `${item.originalName}::${item.size}`
      const existing = existingByIdentity.get(identityKey)

      if (existing && query.conflictMode !== 'overwrite') {
        // Already present on this site — point restored content at the existing row's
        // URL instead of re-uploading/re-inserting a duplicate.
        urlMap.set(item.url, existing.url)
        mediaResult.skipped++
        continue
      }

      // Local-fallback ("data:" URI) media items are never bundled into the zip — the
      // URI is already self-contained text (see buildBackup) — so there's no file to
      // re-upload and no URL rewrite needed. But without this, the item's Media Library
      // row would just never be recreated: the image still renders in restored content
      // (a data: URI needs no hosting), yet it'd be missing from Admin → Media entirely.
      if (item.url.startsWith('data:')) {
        try {
          const rowId = existing?.id ?? ulid()
          const values = {
            siteId,
            uploadedBy: userId,
            filename: item.originalName,
            originalName: item.originalName,
            mimeType: item.mimeType,
            size: item.size,
            width: item.width ?? undefined,
            height: item.height ?? undefined,
            url: item.url,
            storageProvider: 'local' as const,
            // Never taken from the backup: a .zip is user-editable, and a storage key naming
            // another tenant's object was a way to get that object deleted through this
            // site's media library. A local row's bytes live in `url`, so the key is inert.
            storageKey: `${siteId}/${rowId}`,
            altText: item.altText ?? undefined,
            caption: item.caption ?? undefined,
          }
          if (existing) {
            await db.update(media).set(values).where(eq(media.id, existing.id))
          } else {
            await db.insert(media).values({ id: rowId, ...values })
          }
          mediaResult.uploaded++
        } catch (e) {
          // Without this, a corrupt local-fallback entry and a legitimate
          // "already existed, skipped" case look identical in the response.
          console.error(`[restore] Failed to restore local media item "${item.originalName}":`, e)
          mediaResult.skipped++
        }
        continue
      }

      const zipPath = item.zipPath
      if (zipPath && (zipPath.includes('..') || zipPath.startsWith('/') || zipPath.startsWith('\\'))) {
        throw badRequest(`Invalid zipPath in backup metadata: ${zipPath}. Directory traversal is forbidden.`)
      }
      if (!zipPath) {
        mediaResult.skipped++
        continue
      }
      try {
        const imageData = readZipEntry(zipPath)
        if (!imageData) {
          mediaResult.skipped++
          continue
        }
        const ext = item.originalName.split('.').pop() ?? 'bin'
        const storageKey = `${siteId}/${ulid()}.${ext}`
        const imageFile = new File([imageData as Uint8Array<ArrayBuffer>], item.originalName, { type: item.mimeType })
        const { url } = await provider.upload(imageFile, storageKey, siteId)

        urlMap.set(item.url, url)
        mediaResult.uploaded++

        const values = {
          siteId,
          uploadedBy: userId,
          filename: storageKey,
          originalName: item.originalName,
          mimeType: item.mimeType,
          size: item.size,
          width: item.width ?? undefined,
          height: item.height ?? undefined,
          url,
          storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
          storageKey,
          altText: item.altText ?? undefined,
          caption: item.caption ?? undefined,
        }
        if (existing) {
          await db.update(media).set(values).where(eq(media.id, existing.id))
        } else {
          await db.insert(media).values({ id: ulid(), ...values })
        }
      } catch (e) {
        // A corrupt zip entry, provider timeout, or malformed image would
        // otherwise look identical to an intentional skip in the response.
        console.error(`[restore] Failed to restore media item "${item.originalName}" (zipPath: ${item.zipPath}):`, e)
        mediaResult.skipped++
      }
    }

    if (urlMap.size > 0) {
      backup = rewriteImageUrls(backup, urlMap)
    }
  }

  const result = await applyBackup(event, siteId, backup, { what, conflictMode: query.conflictMode })

  // Restored content, settings (SEO, appearance) and redirects all feed cached pages,
  // sitemaps, robots.txt and llms.txt — clear them now rather than serve pre-restore
  // copies for up to an hour. Backgrounded, same as a settings save.
  waitUntil(event, purgeAllPublicPages(event, siteId).catch((err) => {
    console.error('[restore] Failed to purge page cache after restore:', err)
  }))

  await writeAuditLog(event, userId, {
    action: 'restore',
    resource: 'site',
    resourceId: siteId,
    after: { what, conflictMode: query.conflictMode, result, media: mediaResult },
  })

  return { success: true, result, media: mediaResult }
})
