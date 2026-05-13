import { requireRole } from '../../../utils/permissions'
import { putThemeCSS, putThemeDemo } from '../../../utils/cf-env'
import { themes, media } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { unzipSync } from 'fflate'
import { getActiveProvider } from '../../../utils/media-providers/index'
import type { NuxFlowBackup } from '../../../utils/backup'

const MAX_ZIP_BYTES = 50 * 1024 * 1024 // 50 MB
const IMAGE_EXT = /\.(?:jpg|jpeg|png|webp|gif|svg|avif|ico)$/i

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
}

interface CssBody { name: string; version?: string; css: string }

function parseDemoSummary(backup: NuxFlowBackup) {
  return {
    pages: backup.content?.filter(c => c.typeSlug === 'page').length ?? 0,
    posts: backup.content?.filter(c => c.typeSlug === 'post').length ?? 0,
    menus: backup.menus?.length ?? 0,
    forms: backup.forms?.length ?? 0,
  }
}

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const contentType = getHeader(event, 'content-type') ?? ''
  const isMultipart = contentType.includes('multipart/form-data')

  let name = ''
  let version = '1.0.0'
  let css = ''
  let demoJson: string | null = null

  if (isMultipart) {
    const formData = await readMultipartFormData(event)
    if (!formData) throw createError({ statusCode: 400, message: 'No form data' })

    const fileField = formData.find(f => f.name === 'file')

    if (fileField?.filename?.endsWith('.zip')) {
      // ── Zip theme package ─────────────────────────────────────────────────
      if (fileField.data.byteLength > MAX_ZIP_BYTES) {
        throw createError({ statusCode: 413, message: 'Theme zip exceeds 50 MB limit' })
      }

      let files: Record<string, Uint8Array>
      try {
        files = unzipSync(fileField.data)
      } catch {
        throw createError({ statusCode: 400, message: 'Invalid zip file' })
      }

      const cssFile = files['theme.css']
      if (!cssFile) throw createError({ statusCode: 400, message: 'theme.css not found in zip' })
      css = new TextDecoder().decode(cssFile)

      const metaFile = files['theme.json']
      if (metaFile) {
        try {
          const meta = JSON.parse(new TextDecoder().decode(metaFile)) as { name?: string; version?: string }
          name = meta.name?.trim() || ''
          version = meta.version?.trim() || '1.0.0'
        } catch { /* use defaults */ }
      }

      if (files['demo.json']) {
        try {
          demoJson = new TextDecoder().decode(files['demo.json'])
          JSON.parse(demoJson) // validate
        } catch {
          demoJson = null
        }
      }

      if (!name) {
        name = (fileField.filename ?? 'Uploaded Theme').replace(/\.zip$/i, '').replace(/[-_]/g, ' ')
      }

      // ── Upload images and rewrite demo.json references ────────────────────
      const imageEntries = Object.entries(files).filter(
        ([path]) => path.startsWith('images/') && IMAGE_EXT.test(path),
      )

      if (imageEntries.length > 0 && demoJson) {
        const provider = getActiveProvider()
        const themeImageId = ulid() // stable prefix so all theme images share a folder

        for (const [zipPath, imageData] of imageEntries) {
          const filename = zipPath.split('/').pop()!
          const ext = filename.split('.').pop()?.toLowerCase() ?? 'bin'
          const mimeType = MIME_MAP[ext] ?? 'application/octet-stream'
          const storageKey = `${siteId}/themes/${themeImageId}/${filename}`

          try {
            const imageFile = new File([imageData], filename, { type: mimeType })
            const { url } = await provider.upload(imageFile, storageKey, siteId)

            // Rewrite all occurrences of the relative path in demo.json
            demoJson = demoJson.replaceAll(zipPath, url)

            // Add to media library so it's visible/manageable
            await db.insert(media).values({
              id: ulid(),
              siteId,
              uploadedBy: userId,
              filename: storageKey,
              originalName: filename,
              mimeType,
              size: imageData.byteLength,
              url,
              storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
              storageKey,
            })
          } catch { /* skip — demo will just have a missing image */ }
        }
      }
    } else {
      const get = (n: string) => formData.find(f => f.name === n)
      name = get('name') ? new TextDecoder().decode(get('name')!.data) : ''
      version = get('version') ? new TextDecoder().decode(get('version')!.data) : '1.0.0'
      css = get('css') ? new TextDecoder().decode(get('css')!.data) : ''
    }
  } else {
    const body = await readBody<CssBody>(event)
    name = body.name?.trim() ?? ''
    version = body.version?.trim() || '1.0.0'
    css = body.css?.trim() ?? ''
  }

  if (!name) throw createError({ statusCode: 400, message: 'Theme name is required' })
  if (!css) throw createError({ statusCode: 400, message: 'theme.css is required' })

  const id = ulid()
  await putThemeCSS(event, siteId, id, css)
  if (demoJson) await putThemeDemo(event, siteId, id, demoJson)

  const hasDemoContent = demoJson !== null
  await db.insert(themes).values({
    id, siteId,
    packageName: `@dynamic/theme-${id}`,
    name, version,
    isActive: false,
    hasCss: true,
    settings: hasDemoContent ? { hasDemoContent: true } : undefined,
  })

  const anyActive = await db.query.themes.findFirst({
    where: and(eq(themes.siteId, siteId), eq(themes.isActive, true)),
    columns: { id: true },
  })
  if (!anyActive) {
    await db.update(themes).set({ isActive: true }).where(and(eq(themes.id, id), eq(themes.siteId, siteId)))
  }

  const demoSummary = hasDemoContent
    ? parseDemoSummary(JSON.parse(demoJson!) as NuxFlowBackup)
    : null

  return { success: true, id, hasDemoContent, demoSummary }
})
