import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { applyBackup, rewriteImageUrls } from '../../utils/backup'
import type { NuxFlowBackup, RestoreOptions } from '../../utils/backup'
import { unzipSync } from 'fflate'
import { getActiveProvider } from '../../utils/media-providers/index'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from '../../utils/db'
import { validateZipArchive } from '../../utils/security'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

const querySchema = z.object({
  what: z.string().default('content,taxonomies,menus,forms,settings'),
  conflictMode: z.enum(['skip', 'overwrite']).default('skip'),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const siteId = event.context.siteId as string
  const db = useDb(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  const what = query.what.split(',').filter(
    (w): w is RestoreOptions['what'][number] =>
      ['content', 'taxonomies', 'menus', 'forms', 'settings'].includes(w),
  )

  const formData = await readMultipartFormData(event)
  const file = formData?.find(f => f.name === 'file')
  if (!file) throw createError({ statusCode: 400, message: 'No file uploaded' })

  if (file.data.byteLength > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, message: 'Backup file exceeds 100 MB limit' })
  }  // Robustly validate the ZIP archive for Zip Slip (path traversal) and Zip Bomb (uncompressed size)
  validateZipArchive(file.data, MAX_UPLOAD_BYTES)

  let rawZipFiles: Record<string, Uint8Array>
  try {
    rawZipFiles = unzipSync(file.data)
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'statusCode' in e) throw e
    throw createError({ statusCode: 400, message: 'Invalid zip file — upload a NuxFlow .zip backup' })
  }
  // Normalize zip entry paths to forward-slashes to support Windows-packaged ZIP archives
  const zipFiles = Object.fromEntries(
    Object.entries(rawZipFiles).map(([path, data]) => [path.replace(/\\/g, '/'), data])
  )

  const backupFile = zipFiles['backup.json']
  if (!backupFile) throw createError({ statusCode: 400, message: 'backup.json not found in zip' })

  let backup: NuxFlowBackup
  try {
    backup = JSON.parse(new TextDecoder().decode(backupFile)) as NuxFlowBackup
  } catch {
    throw createError({ statusCode: 400, message: 'backup.json is not valid JSON' })
  }

  if (backup.version !== '1') {
    throw createError({ statusCode: 400, message: `Unsupported backup version: ${backup.version}` })
  }

  const mediaResult = { uploaded: 0, skipped: 0 }

  // Re-upload bundled images to the active media provider
  if (backup.media?.length && what.includes('content')) {
    const provider = await getActiveProvider(event)
    const urlMap = new Map<string, string>()

    for (const item of backup.media) {
      const zipPath = item.zipPath
      if (zipPath && (zipPath.includes('..') || zipPath.startsWith('/') || zipPath.startsWith('\\'))) {
        throw createError({
          statusCode: 400,
          message: `Invalid zipPath in backup metadata: ${zipPath}. Directory traversal is forbidden.`,
        })
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

  return { success: true, result, media: mediaResult }
})
