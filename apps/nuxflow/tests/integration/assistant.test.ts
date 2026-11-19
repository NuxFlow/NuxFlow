/**
 * POST /_nuxflow/assistant — the admin AI helper. The model is mocked; what's tested is
 * what the route does with its output: only proposals on the safe list, with allowed
 * values, that the person's role may make, for this site's own pages, survive — and the
 * route never changes anything itself.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedSetting } from '../helpers/seed'
import { siteSettings } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import type { AssistantResponse } from '../../shared/lib/assistant'

vi.mock('../../server/utils/db', () => ({ useDb: () => getCurrentTestDb(), getD1: () => null }))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/setup-checklist', () => ({
  gatherSetupChecklistInputs: vi.fn().mockResolvedValue({}),
  buildSetupChecklist: () => [{ id: 'email', tier: 'essential', status: 'todo', title: 'Set up email', detail: 'No email provider yet.', fixUrl: '/admin/settings?tab=Email' }],
}))

const { mockGenerateObject } = vi.hoisted(() => ({ mockGenerateObject: vi.fn() }))
vi.mock('ai', () => ({ generateObject: mockGenerateObject }))
vi.mock('../../server/utils/ai-sdk', () => ({
  requireAiSdkModel: vi.fn().mockResolvedValue(Symbol('model')),
  callAiOrThrow: <T>(fn: () => Promise<T>) => fn(),
}))

const { default: handler } = await import('../../server/routes/_nuxflow/assistant.post')

const SITE = 'site-assist-01'
const OTHER = 'site-assist-02'
let adminId: string
let editorId: string
let canvasPageId: string
let prosePageId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'assist.localhost', name: 'Bean Café' })
  await seedSite(db, { id: OTHER, domain: 'other-assist.localhost' })
  adminId = await seedUser(db, { email: 'admin@assist.test' })
  editorId = await seedUser(db, { email: 'editor@assist.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
  const typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
  canvasPageId = await seedContentItem(db, SITE, typeId, { slug: 'home', title: 'Home', content: { type: 'canvas', blocks: [] } })
  prosePageId = await seedContentItem(db, SITE, typeId, { slug: 'story', title: 'Our story', content: { type: 'doc', content: [] } })
  const otherType = await seedContentType(db, OTHER, { slug: 'page', name: 'Pages', singularName: 'Page' })
  await seedContentItem(db, OTHER, otherType, { slug: 'secret', title: 'Other site page', content: { type: 'canvas', blocks: [] } })
  await seedSetting(db, SITE, 'theme.dark_mode', 'light')
})

afterAll(teardownTestDb)

function ask(userId: string, text: string, extra: Record<string, unknown> = {}) {
  return (handler as (e: H3Event) => Promise<AssistantResponse>)(createMockEvent({
    siteId: SITE,
    method: 'POST',
    session: { user: { id: userId, name: 'U', email: 'u@assist.test' } },
    body: { messages: [{ role: 'user', text }], sections: [{ label: 'Settings → Appearance', to: '/admin/settings?tab=Appearance' }], ...extra },
  }) as unknown as H3Event)
}

const proposal = (p: Record<string, string>) => ({ type: 'setting', key: '', value: '', page: '', instruction: '', to: '', note: '', ...p })

describe('POST /_nuxflow/assistant', () => {
  it('gives the model the site, its pages, current settings, the checklist and the screens', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { reply: 'Hi', proposals: [] } })
    await ask(adminId, 'Switch to dark mode')
    const [args] = mockGenerateObject.mock.calls.at(-1) as [{ system: string; prompt: string }]
    expect(args.system).toContain('"Bean Café"')
    expect(args.system).toContain('theme.dark_mode')
    expect(args.system).toContain('Now: "light"')
    expect(args.system).toContain('"Home"')
    expect(args.system).toContain('not a Canvas page')
    expect(args.system).not.toContain('Other site page')
    expect(args.system).toContain('Set up email')
    expect(args.system).toContain('/admin/settings?tab=Appearance — Settings → Appearance')
    expect(args.prompt).toContain('PERSON: Switch to dark mode')
  })

  it('keeps valid proposals and drops anything off the list, invalid, unchanged or unknown', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        reply: 'I can switch it to dark.',
        proposals: [
          proposal({ key: 'theme.dark_mode', value: 'dark', note: 'Dark site' }),
          proposal({ key: 'theme.dark_mode', value: 'auto' }),
          proposal({ key: 'appearance.custom_head_html', value: '<script>' }),
          proposal({ key: 'theme.primary_color', value: 'javascript:1' }),
          proposal({ key: 'frontend.show_header', value: 'true' }),
          { ...proposal({}), type: 'page', page: 'p1', instruction: 'Make the hero dark' },
          { ...proposal({}), type: 'page', page: 'p2', instruction: 'Rewrite it' },
          { ...proposal({}), type: 'page', page: 'p99', instruction: 'Nope' },
          { ...proposal({}), type: 'link', to: '/admin/settings?tab=Appearance' },
          { ...proposal({}), type: 'link', to: 'https://evil.example' },
        ],
      },
    })
    const res = await ask(adminId, 'Make it dark')
    expect(res.reply).toBe('I can switch it to dark.')
    const items = res.proposals.map(p => (p.type === 'setting' ? `${p.key}=${String(p.value)} (was ${String(p.current)})` : p.type === 'page' ? `page:${p.contentId}` : `link:${p.to}`))
    expect(items).toEqual([
      'theme.dark_mode=dark (was light)',
      // A switch that's already on (never saved = on) isn't a change.
      expect.stringMatching(new RegExp(`^page:(${canvasPageId}|${prosePageId})$`)),
      'link:/admin/settings?tab=Appearance',
    ])
    // Only the Canvas page can be changed with AI.
    expect(res.proposals.find(p => p.type === 'page')).toMatchObject({ contentId: canvasPageId })
  })

  it('never proposes settings to someone who is not an admin', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { reply: 'Ask an admin.', proposals: [proposal({ key: 'theme.dark_mode', value: 'dark' })] } })
    const res = await ask(editorId, 'Make it dark')
    expect(res.proposals).toEqual([])
    const [args] = mockGenerateObject.mock.calls.at(-1) as [{ system: string }]
    expect(args.system).toContain('not an admin')
    expect(args.system).not.toContain('Set up email')
  })

  it('changes nothing itself', async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: { reply: 'Ok', proposals: [proposal({ key: 'theme.dark_mode', value: 'dark' })] } })
    await ask(adminId, 'Make it dark')
    const row = await getCurrentTestDb().query.siteSettings.findFirst({ where: eq(siteSettings.key, 'theme.dark_mode') })
    expect(row!.value).toBe('light')
  })

  it('refuses a conversation that does not end with a question, and links outside the admin', async () => {
    await expect(ask(adminId, 'x', { messages: [{ role: 'assistant', text: 'Hi' }] })).rejects.toThrow()
    await expect(ask(adminId, 'x', { sections: [{ label: 'Evil', to: 'https://evil.example' }] })).rejects.toThrow()
  })
})
