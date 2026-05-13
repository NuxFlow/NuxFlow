import { z } from 'zod'
import { requireRole } from '../../utils/permissions'
import { applyBackup, rewriteImageUrls } from '../../utils/backup'
import type { NuxFlowBackup, RestoreOptions } from '../../utils/backup'
import { unzipSync } from 'fflate'
import { getActiveProvider } from '../../utils/media-providers/index'
import { media } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { useDb } from '../../utils/db'

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
  }

  let backup: NuxFlowBackup
  const mediaResult = { uploaded: 0, skipped: 0 }

  const isZip = file.filename?.endsWith('.zip')
    || file.type === 'application/zip'
    || file.type === 'application/x-zip-compressed'

  if (isZip) {
    let zipFiles: Record<string, Uint8Array>
    try {
      zipFiles = unzipSync(file.data)
    } catch {
      throw createError({ statusCode: 400, message: 'Invalid zip file' })
    }

    const backupFile = zipFiles['backup.json']
    if (!backupFile) throw createError({ statusCode: 400, message: 'backup.json not found in zip' })

    try {
      backup = JSON.parse(new TextDecoder().decode(backupFile)) as NuxFlowBackup
    } catch {
      throw createError({ statusCode: 400, message: 'backup.json is not valid JSON' })
    }

    // Re-upload bundled images to the active media provider
    if (backup.media?.length && what.includes('content')) {
      const provider = getActiveProvider()
      const urlMap = new Map<string, string>()

      for (const item of backup.media) {
        if (!item.zipPath || !zipFiles[item.zipPath]) {
          mediaResult.skipped++
          continue
        }
        try {
          const imageData = zipFiles[item.zipPath]
          const ext = item.originalName.split('.').pop() ?? 'bin'
          const storageKey = `${siteId}/${ulid()}.${ext}`
          const imageFile = new File([imageData], item.originalName, { type: item.mimeType })
          const { url } = await provider.upload(imageFile, storageKey, siteId)

          urlMap.set(item.url, url)
          mediaResult.uploaded++

          // Insert into media library
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
  } else {
    try {
      backup = JSON.parse(new TextDecoder().decode(file.data)) as NuxFlowBackup
    } catch {
      throw createError({ statusCode: 400, message: 'Invalid backup file — expected JSON or ZIP' })
    }
  }

  if (backup.version !== '1') {
    throw createError({ statusCode: 400, message: `Unsupported backup version: ${backup.version}` })
  }

  const result = await applyBackup(event, siteId, backup, { what, conflictMode: query.conflictMode })

  return { success: true, result, media: mediaResult }
})
