import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { applyBackup, parseBackupJson, rewriteImageUrls } from '../../utils/backup'
import type { NuxFlowBackup, RestoreOptions } from '../../utils/backup'
import { unzipSync } from 'fflate'
import { getActiveProvider } from '../../utils/media-providers/index'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from '../../utils/db'
import { validateZipArchive } from '../../utils/security'
import { isHttpError } from '../../utils/errors'
import { writeAuditLog } from '../../utils/audit'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

const querySchema = z.object({
  what: z.string().default('content,taxonomies,menus,forms,settings,site'),
  conflictMode: z.enum(['skip', 'overwrite', 'archive']).default('skip'),
})

// A .zip always starts with a "PK" local-file-header signature; anything else uploaded
// here is treated as a raw backup.json (the "content only" option the Restore UI offers
// alongside .zip — no bundled media, images keep pointing at their original site).
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4B
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const query = await parseQuery(event, querySchema)

  const what = query.what.split(',').filter(
    (w): w is RestoreOptions['what'][number] =>
      ['content', 'taxonomies', 'menus', 'forms', 'settings', 'site', 'themes', 'plugins', 'users', 'membershipTiers'].includes(w),
  )

  const formData = await readMultipartFormData(event)
  const file = formData?.find(f => f.name === 'file')
  if (!file) throw badRequest('No file uploaded')

  if (file.data.byteLength > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, message: 'Backup file exceeds 100 MB limit' })
  }

  let backup: NuxFlowBackup
  // zipFiles stays empty for a raw .json upload — every backup.media entry then has no
  // matching zip entry below, so the media re-upload loop naturally skips all of them
  // (content-only: images keep referencing their original site's URLs).
  let zipFiles: Record<string, Uint8Array> = {}

  if (looksLikeZip(file.data)) {
    // Robustly validate the ZIP archive for Zip Slip (path traversal) and Zip Bomb (uncompressed size)
    validateZipArchive(file.data, MAX_UPLOAD_BYTES)

    let rawZipFiles: Record<string, Uint8Array>
    try {
      rawZipFiles = unzipSync(file.data)
    } catch (e: unknown) {
      if (isHttpError(e)) throw e
      throw badRequest('Invalid zip file — upload a NuxFlow .zip or .json backup')
    }
    // Normalize zip entry paths to forward-slashes to support Windows-packaged ZIP archives
    zipFiles = Object.fromEntries(
      Object.entries(rawZipFiles).map(([path, data]) => [path.replace(/\\/g, '/'), data])
    )

    const backupFile = zipFiles['backup.json']
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

    for (const item of backup.media) {
      // Local-fallback ("data:" URI) media items are never bundled into the zip — the
      // URI is already self-contained text (see buildBackup) — so there's no file to
      // re-upload and no URL rewrite needed. But without this, the item's Media Library
      // row would just never be recreated: the image still renders in restored content
      // (a data: URI needs no hosting), yet it'd be missing from Admin → Media entirely.
      if (item.url.startsWith('data:')) {
        try {
          await db.insert(media).values({
            id: ulid(),
            siteId,
            uploadedBy: userId,
            filename: item.originalName,
            originalName: item.originalName,
            mimeType: item.mimeType,
            size: item.size,
            width: item.width ?? undefined,
            height: item.height ?? undefined,
            url: item.url,
            storageProvider: 'local',
            storageKey: item.originalName,
            altText: item.altText ?? undefined,
            caption: item.caption ?? undefined,
          })
          mediaResult.uploaded++
        } catch {
          mediaResult.skipped++
        }
        continue
      }

      const zipPath = item.zipPath
      if (zipPath && (zipPath.includes('..') || zipPath.startsWith('/') || zipPath.startsWith('\\'))) {
        throw badRequest(`Invalid zipPath in backup metadata: ${zipPath}. Directory traversal is forbidden.`)
      }
      const rawData = zipPath ? zipFiles[zipPath] : undefined
      if (!zipPath || !rawData) {
        mediaResult.skipped++
        continue
      }
      try {
        const imageData = new Uint8Array(rawData)
        const ext = item.originalName.split('.').pop() ?? 'bin'
        const storageKey = `${siteId}/${ulid()}.${ext}`
        const imageFile = new File([imageData], item.originalName, { type: item.mimeType })
        const { url } = await provider.upload(imageFile, storageKey, siteId)

        urlMap.set(item.url, url)
        mediaResult.uploaded++

        await db.insert(media).values({
          id: ulid(),
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
        })
      } catch {
        mediaResult.skipped++
      }
    }

    if (urlMap.size > 0) {
      backup = rewriteImageUrls(backup, urlMap)
    }
  }

  const result = await applyBackup(event, siteId, backup, { what, conflictMode: query.conflictMode })

  await writeAuditLog(event, userId, {
    action: 'restore',
    resource: 'site',
    resourceId: siteId,
    after: { what, conflictMode: query.conflictMode, result, media: mediaResult },
  })

  return { success: true, result, media: mediaResult }
})
