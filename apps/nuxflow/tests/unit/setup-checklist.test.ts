import { describe, it, expect } from 'vitest'
import { buildSetupChecklist, type ChecklistInputs } from '../../server/utils/setup-checklist'

const healthy: ChecklistInputs = {
  storageProvider: 'r2',
  localMediaCount: 0,
  emailProvider: 'cloudflare',
  hasEmailBinding: true,
  lastEmail: { status: 'sent', error: null, createdAt: '2026-09-27 10:00:00' },
  siteDomain: 'example.com',
  authSecret: 'k3J9x2Qm8vT1pL6wZr4nY7cB0dF5hG2s',
  seo: { noindex: false, description: 'A site', ogImage: '/og.png', indexnowEnabled: true, verification: { google: 'g', bing: '', yandex: '', pinterest: '' } },
  aiAvailable: true,
  aiProvider: 'workers-ai',
  turnstileSiteKey: '0x4AAA',
  hasTurnstileSecret: true,
  formCount: 1,
  userPasskeyCount: 1,
  lastBackupAt: '2026-09-20 10:00:00',
  siteCount: 1,
  accountsOrigin: null,
  now: new Date('2026-09-28T00:00:00Z'),
}

const status = (items: ReturnType<typeof buildSetupChecklist>, id: string) => items.find(i => i.id === id)!

describe('buildSetupChecklist', () => {
  it('marks a fully configured site as all done', () => {
    const items = buildSetupChecklist(healthy)
    expect(items.every(i => i.status === 'done')).toBe(true)
    expect(items.filter(i => i.tier === 'essential').map(i => i.id)).toEqual(['storage', 'email', 'domain', 'secret', 'seo'])
  })

  it('flags database image storage, and leftover database files once storage is connected', () => {
    expect(status(buildSetupChecklist({ ...healthy, storageProvider: 'local' }), 'storage')).toMatchObject({ status: 'todo', title: 'Connect file storage' })
    const leftover = status(buildSetupChecklist({ ...healthy, localMediaCount: 3 }), 'storage')
    expect(leftover.status).toBe('todo')
    expect(leftover.detail).toContain('3 files are still stored in the database')
  })

  it('treats the console email provider as not sending, and surfaces a missing binding or a failed send', () => {
    expect(status(buildSetupChecklist({ ...healthy, emailProvider: 'console' }), 'email').status).toBe('todo')
    expect(status(buildSetupChecklist({ ...healthy, emailProvider: '' }), 'email').status).toBe('todo')
    expect(status(buildSetupChecklist({ ...healthy, hasEmailBinding: false }), 'email')).toMatchObject({ status: 'problem' })
    const failed = status(buildSetupChecklist({ ...healthy, lastEmail: { status: 'failed', error: 'domain not verified', createdAt: '2026-09-27 10:00:00' } }), 'email')
    expect(failed.status).toBe('problem')
    expect(failed.detail).toContain('domain not verified')
  })

  it('wants a real custom domain', () => {
    expect(status(buildSetupChecklist({ ...healthy, siteDomain: 'nuxflow.acct.workers.dev' }), 'domain').status).toBe('todo')
    expect(status(buildSetupChecklist({ ...healthy, siteDomain: 'localhost' }), 'domain').detail).toContain('local development')
  })

  it('flags missing, short, or placeholder auth secrets', () => {
    expect(status(buildSetupChecklist({ ...healthy, authSecret: '' }), 'secret').status).toBe('problem')
    expect(status(buildSetupChecklist({ ...healthy, authSecret: 'short' }), 'secret').status).toBe('problem')
    expect(status(buildSetupChecklist({ ...healthy, authSecret: 'change-me-32-chars-minimum-please!!' }), 'secret').status).toBe('problem')
  })

  it('treats a noindexed site as a problem and missing SEO basics as a to-do', () => {
    expect(status(buildSetupChecklist({ ...healthy, seo: { ...healthy.seo, noindex: true } }), 'seo').status).toBe('problem')
    const missing = status(buildSetupChecklist({ ...healthy, seo: { ...healthy.seo, description: '', ogImage: '' } }), 'seo')
    expect(missing.status).toBe('todo')
    expect(missing.detail).toContain('a default description and a default share image')
  })

  it('catches half-configured Turnstile in both directions', () => {
    const keyOnly = status(buildSetupChecklist({ ...healthy, hasTurnstileSecret: false }), 'turnstile')
    expect(keyOnly.status).toBe('problem')
    expect(keyOnly.detail).toContain('aren\'t actually verified')
    const secretOnly = status(buildSetupChecklist({ ...healthy, turnstileSiteKey: '' }), 'turnstile')
    expect(secretOnly.status).toBe('problem')
    expect(secretOnly.detail).toContain('every form submission is rejected')
    expect(status(buildSetupChecklist({ ...healthy, turnstileSiteKey: '', hasTurnstileSecret: false }), 'turnstile').status).toBe('todo')
  })

  it('asks for a backup when there is none or it is over 30 days old', () => {
    expect(status(buildSetupChecklist({ ...healthy, lastBackupAt: null }), 'backup').status).toBe('todo')
    const stale = status(buildSetupChecklist({ ...healthy, lastBackupAt: '2026-07-01 00:00:00' }), 'backup')
    expect(stale.status).toBe('todo')
    expect(stale.detail).toMatch(/last backup was \d+ days ago/)
  })

  it('requires a central sign-in domain once there is more than one site', () => {
    expect(buildSetupChecklist(healthy).some(i => i.id === 'accounts')).toBe(false)
    expect(status(buildSetupChecklist({ ...healthy, siteCount: 2 }), 'accounts')).toMatchObject({ status: 'problem', tier: 'essential' })
    const central = buildSetupChecklist({ ...healthy, siteCount: 2, accountsOrigin: 'https://accounts.example.com', userPasskeyCount: 0 })
    expect(status(central, 'accounts').status).toBe('done')
    // Passkeys live on the accounts origin under central sign-in.
    expect(status(central, 'passkey').fixUrl).toBe('https://accounts.example.com/account')
  })

  it('flags recommended items that are off', () => {
    const items = buildSetupChecklist({ ...healthy, aiAvailable: false, userPasskeyCount: 0, seo: { ...healthy.seo, indexnowEnabled: false } })
    expect(status(items, 'ai')).toMatchObject({ status: 'todo', tier: 'recommended' })
    expect(status(items, 'passkey').status).toBe('todo')
    expect(status(items, 'indexnow').status).toBe('todo')
  })
})
