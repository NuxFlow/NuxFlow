import { requireRole } from '../../utils/permissions'
import { buildBackup } from '../../utils/backup'
import { zipSync } from 'fflate'
import { isSafeUrl } from '../../utils/security'

const MAX_RAW_IMAGE_BYTES = 100 * 1024 * 1024 // 100 MB uncompressed

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = event.context.siteId as string

  const backup = await buildBackup(event, siteId)
  const zipFiles: Record<string, Uint8Array> = {}

  // Fetch and bundle each media item
  let rawBytes = 0
  for (const item of backup.media) {
    // Skip data URIs — they're already embedded as text and would bloat the zip
    if (item.url.startsWith('data:')) continue

    // SSRF Prevention: Block local or private IP requests
    if (!isSafeUrl(item.url)) {
      continue
    }

    try {
      const res = await fetch(item.url)
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())

      rawBytes += bytes.byteLength
      if (rawBytes > MAX_RAW_IMAGE_BYTES) {
        throw createError({
          statusCode: 413,
          message: 'Backup exceeds 100 MB of media. Remove unused media files and try again.',
        })
      }

      const ext = item.originalName.split('.').pop() ?? 'bin'
      item.zipPath = `images/${item.id}.${ext}`
      zipFiles[item.zipPath] = bytes
    } catch (err) {
      if (err && typeof err === 'object' && 'statusCode' in err) throw err
      // Network error fetching this image — skip it, zipPath stays null
    }
  }

  zipFiles['backup.json'] = new TextEncoder().encode(JSON.stringify(backup, null, 2))

  // level 1 = fast compression; images are already compressed formats, so little gain from higher levels
  const zipBytes = zipSync(zipFiles, { level: 1 })

  const filename = `nuxflow-backup-${new Date().toISOString().slice(0, 10)}.zip`
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  return zipBytes
})

