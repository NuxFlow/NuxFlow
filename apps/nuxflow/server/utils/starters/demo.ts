// Reading a starter's demo.json. Theme bundles and hand-made starters are older or looser
// than a real backup (`"version": 1` as a number, no `media`/`themes`/`users` arrays…), so the
// envelope is filled in before the content is validated with the backup schema. Only the
// parts a starter may carry are kept. Import-free of request code: the catalog build script
// (scripts/starters/build.ts) runs the same check, so a broken starter fails when it's built.
import { nuxFlowBackupSchema, type NuxFlowBackup } from '../backup-types'

export function parseStarterDemo(text: string): NuxFlowBackup {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('The starter site\'s demo.json is not valid JSON.')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The starter site\'s demo.json is not an object.')
  const raw = json as Record<string, unknown>
  const list = (key: string) => (Array.isArray(raw[key]) ? raw[key] : [])
  const filled = {
    version: '1',
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
    site: { name: 'Starter', locale: 'en', timezone: 'UTC' },
    settings: raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {},
    contentTypes: list('contentTypes'),
    content: list('content'),
    taxonomies: list('taxonomies'),
    menus: list('menus'),
    forms: list('forms'),
    // Never taken from a starter.
    media: [], themes: [], plugins: [], users: [], membershipTiers: [], redirects: [],
  }
  const result = nuxFlowBackupSchema.safeParse(filled)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`The starter site's demo.json doesn't match the backup format${issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''}.`)
  }
  return result.data
}
