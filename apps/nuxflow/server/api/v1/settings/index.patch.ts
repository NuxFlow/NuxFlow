import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sites } from '@nuxflow/db/schema'
import { eq, sql } from 'drizzle-orm'
import { saveSetting } from '../../../utils/settings'
import { clearAppearanceCache } from '../../../plugins/site-settings-resolver'

const bodySchema = z.object({
  // Site columns
  name: z.string().min(1).max(100).optional(),
  domain: z.string().min(1).max(100).optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  status: z.enum(['active', 'maintenance']).optional(),
  // Site settings (key-value store)
  settings: z.record(z.unknown()).optional(),
  // AI settings compatibility
  ai: z.object({
    provider: z.string().optional(),
    openaiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    ollamaBaseUrl: z.string().optional(),
    ollamaModel: z.string().optional(),
  }).optional(),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await readValidatedBody(event, bodySchema.parse)

  const siteUpdate = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.domain !== undefined && { domain: body.domain }),
    ...(body.locale !== undefined && { locale: body.locale }),
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.status !== undefined && { status: body.status }),
  }

  if (Object.keys(siteUpdate).length > 0) {
    await db.update(sites)
      .set({ ...siteUpdate, updatedAt: sql`(datetime('now'))` })
      .where(eq(sites.id, siteId))
  }

  if (body.settings) {
    for (const [key, value] of Object.entries(body.settings)) {
      await saveSetting(event, key, value)
    }
  }

  if (body.ai) {
    const ai = body.ai
    if (ai.provider !== undefined) await saveSetting(event, 'ai.provider', ai.provider)
    if (ai.openaiApiKey !== undefined) await saveSetting(event, 'ai.openai_api_key', ai.openaiApiKey)
    if (ai.anthropicApiKey !== undefined) await saveSetting(event, 'ai.anthropic_api_key', ai.anthropicApiKey)
    if (ai.geminiApiKey !== undefined) await saveSetting(event, 'ai.gemini_api_key', ai.geminiApiKey)
    if (ai.ollamaBaseUrl !== undefined) await saveSetting(event, 'ai.ollama_base_url', ai.ollamaBaseUrl)
    if (ai.ollamaModel !== undefined) await saveSetting(event, 'ai.ollama_model', ai.ollamaModel)
  }

  // If any appearance settings changed, bust the per-isolate cache so the next
  // page render picks up the new values immediately.
  const appearanceKeys = new Set(['theme.dark_mode', 'theme.primary_color', 'theme.font_sans'])
  const touchedAppearance = body.settings && Object.keys(body.settings).some(k => appearanceKeys.has(k))
  if (touchedAppearance) clearAppearanceCache(siteId)

  return { success: true }
})
