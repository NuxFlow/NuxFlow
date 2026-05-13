import { requireRole } from '../../../utils/permissions'
import { putThemeCSS, putThemeDemo } from '../../../utils/cf-env'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { useDb } from '../../../utils/db'
import { unzipSync } from 'fflate'
import type { NuxFlowBackup } from '../../../utils/backup'

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
  await requireRole(event, 'admin')
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

      const demoFile = files['demo.json']
      if (demoFile) {
        try {
          demoJson = new TextDecoder().decode(demoFile)
          JSON.parse(demoJson) // validate
        } catch {
          demoJson = null
        }
      }

      if (!name) {
        name = (fileField.filename ?? 'Uploaded Theme').replace(/\.zip$/i, '').replace(/[-_]/g, ' ')
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
