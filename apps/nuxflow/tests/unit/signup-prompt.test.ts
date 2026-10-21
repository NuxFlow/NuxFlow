import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SIGNUP_SETTINGS,
  isBuiltInExcludedPath,
  isExcludedPath,
  isSuppressed,
  parseSignupSettings,
  publicSignupSettings,
  signupReward,
  signupSettingsSchema,
} from '../../shared/lib/signup-prompt'

describe('signup settings', () => {
  it('defaults to the polite options, popup off', () => {
    expect(DEFAULT_SIGNUP_SETTINGS).toMatchObject({
      popupEnabled: false,
      style: 'slide-in',
      trigger: 'engaged',
      hideDays: 30,
      doubleOptIn: true,
      brevoListId: null,
    })
  })

  it('reads a stored value leniently, field by field', () => {
    const s = parseSignupSettings({ heading: 'Hi', delaySeconds: 1, style: 'fullscreen', unknown: 1 })
    expect(s.heading).toBe('Hi')
    expect(s.delaySeconds).toBe(DEFAULT_SIGNUP_SETTINGS.delaySeconds)
    expect(s.style).toBe('slide-in')
    expect(s).not.toHaveProperty('unknown')
    expect(parseSignupSettings(null)).toEqual(DEFAULT_SIGNUP_SETTINGS)
    expect(parseSignupSettings('nonsense')).toEqual(DEFAULT_SIGNUP_SETTINGS)
  })

  it('rejects unsafe reward links and a delay under five seconds', () => {
    expect(signupSettingsSchema.safeParse({ rewardUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(signupSettingsSchema.safeParse({ rewardUrl: '//evil.example' }).success).toBe(false)
    expect(signupSettingsSchema.safeParse({ rewardUrl: '/download' }).success).toBe(true)
    expect(signupSettingsSchema.safeParse({ imageUrl: 'data:image/png;base64,AA' }).success).toBe(false)
    expect(signupSettingsSchema.safeParse({ delaySeconds: 2 }).success).toBe(false)
  })

  it('keeps the reward and list id out of the public copy', () => {
    const pub = publicSignupSettings({ ...DEFAULT_SIGNUP_SETTINGS, rewardText: 'CODE', brevoListId: 3 })
    expect(pub).not.toHaveProperty('rewardText')
    expect(pub).not.toHaveProperty('rewardUrl')
    expect(pub).not.toHaveProperty('brevoListId')
  })

  it('builds the reward only when there is one', () => {
    expect(signupReward(DEFAULT_SIGNUP_SETTINGS)).toBeNull()
    expect(signupReward({ ...DEFAULT_SIGNUP_SETTINGS, rewardUrl: '/guide.pdf' })).toEqual({ text: '', url: '/guide.pdf', label: 'Get it now' })
  })
})

describe('isExcludedPath', () => {
  it('matches whole path segments', () => {
    expect(isExcludedPath('/shop/cart', ['/shop'])).toBe(true)
    expect(isExcludedPath('/shop', ['shop/'])).toBe(true)
    expect(isExcludedPath('/shopping', ['/shop'])).toBe(false)
    expect(isExcludedPath('/Shop/', ['/shop'])).toBe(true)
  })

  it('treats a bare slash as the homepage only', () => {
    expect(isExcludedPath('/', ['/'])).toBe(true)
    expect(isExcludedPath('/about', ['/'])).toBe(false)
  })

  it('always excludes admin, account and the list pages', () => {
    expect(isBuiltInExcludedPath('/admin/content')).toBe(true)
    expect(isBuiltInExcludedPath('/mailing-list/confirm')).toBe(true)
    expect(isBuiltInExcludedPath('/login')).toBe(true)
    expect(isBuiltInExcludedPath('/blog')).toBe(false)
  })
})

describe('isSuppressed', () => {
  const now = Date.UTC(2026, 9, 21)
  it('hides it for subscribers and recently-closed visitors', () => {
    expect(isSuppressed({ subscribed: true }, 30, now)).toBe(true)
    expect(isSuppressed({ dismissedAt: now - 29 * 86_400_000 }, 30, now)).toBe(true)
    expect(isSuppressed({ dismissedAt: now - 31 * 86_400_000 }, 30, now)).toBe(false)
    expect(isSuppressed({}, 30, now)).toBe(false)
  })
})
