import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ASSISTANT_SETTINGS,
  accentReadabilityWarning,
  assistantSettingsPatch,
  contrastRatio,
  describeAssistantValue,
  effectiveAssistantValue,
  isAssistantSettingKey,
  normalizeAssistantSetting,
} from '../../shared/lib/assistant'
import { findGuideSections, splitGuide } from '../../server/utils/assistant-guide'

describe('the settings the AI helper may suggest', () => {
  it('never includes credentials, the domain, custom code, payments or status', () => {
    const keys = Object.keys(ASSISTANT_SETTINGS)
    for (const k of keys) expect(k).not.toMatch(/key|secret|token|password|domain|custom_|html|payments|stripe|status|email|auth\.|ai\./i)
    expect(isAssistantSettingKey('appearance.custom_head_html')).toBe(false)
    expect(isAssistantSettingKey('toString')).toBe(false)
  })

  it('checks every value against the setting', () => {
    expect(normalizeAssistantSetting('theme.dark_mode', 'dark')).toBe('dark')
    expect(normalizeAssistantSetting('theme.dark_mode', 'midnight')).toBeUndefined()
    expect(normalizeAssistantSetting('theme.primary_color', '#1A7F37')).toBe('#1a7f37')
    expect(normalizeAssistantSetting('theme.primary_color', 'red; background:url(x)')).toBeUndefined()
    expect(normalizeAssistantSetting('theme.font_heading', 'Lora')).toBe('Lora')
    expect(normalizeAssistantSetting('theme.font_heading', 'Comic Sans')).toBeUndefined()
    expect(normalizeAssistantSetting('frontend.show_search', 'false')).toBe(false)
    expect(normalizeAssistantSetting('frontend.show_search', 'maybe')).toBeUndefined()
    expect(normalizeAssistantSetting('site.name', '  Bean <b>Café</b>\nLtd ')).toBe('Bean bCafé/b Ltd')
    expect(normalizeAssistantSetting('seo.title', 'x'.repeat(121))).toBeUndefined()
    expect(normalizeAssistantSetting('site.name', '')).toBeUndefined()
  })

  it('reads unsaved settings as the site does (switches on, selects at their first option)', () => {
    expect(effectiveAssistantValue('frontend.show_header', undefined)).toBe(true)
    expect(effectiveAssistantValue('frontend.show_header', false)).toBe(false)
    expect(effectiveAssistantValue('theme.dark_mode', null)).toBe('auto')
    expect(effectiveAssistantValue('theme.font_heading', '')).toBe('same')
    expect(describeAssistantValue('theme.dark_mode', 'dark')).toBe('Always dark')
    expect(describeAssistantValue('frontend.show_toc', false)).toBe('No')
  })

  it('builds the settings save body, with the site name as its own field', () => {
    expect(assistantSettingsPatch({ 'site.name': 'Bean', 'theme.dark_mode': 'dark' })).toEqual({ name: 'Bean', settings: { 'theme.dark_mode': 'dark' } })
    expect(assistantSettingsPatch({ 'theme.primary_color': '#000000' })).toEqual({ settings: { 'theme.primary_color': '#000000' } })
  })
})

describe('answering from the user guide', () => {
  const guide = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/user-guide.md'), 'utf8')
  const sections = splitGuide(guide)

  it('splits the real user guide into titled sections', () => {
    expect(sections.length).toBeGreaterThan(30)
    expect(sections.every(s => s.title && s.body)).toBe(true)
    expect(sections.some(s => s.title.includes('›'))).toBe(true)
  })

  it('finds the sections that match a question', () => {
    expect(findGuideSections(sections, 'How do I change a page with AI?')[0]?.title).toMatch(/Change a page with AI/)
    expect(findGuideSections(sections, 'redirects').some(s => /redirect/i.test(s.title + s.body))).toBe(true)
    expect(findGuideSections(sections, 'the and how')).toEqual([])
  })

  it('handles headings and body text on a small guide', () => {
    const s = splitGuide('# Title\n\n## Email\nSet up **email** here.\n### Sending\nUse a provider.\n## Empty\n')
    expect(s).toEqual([
      { title: 'Email', body: 'Set up **email** here.' },
      { title: 'Email › Sending', body: 'Use a provider.' },
    ])
    expect(findGuideSections(s, 'why is sending email broken')[0]!.title).toBe('Email › Sending')
  })
})

describe('accent colour readability', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('warns when white button text on the accent would be hard to read', () => {
    // The default green fails too, but isn't the owner's choice, so it isn't flagged.
    expect(contrastRatio('#00dc82', '#ffffff')).toBeLessThan(3)
    expect(accentReadabilityWarning('#00DC82')).toBeNull()
    expect(accentReadabilityWarning('#ffeb3b')).toMatch(/hard to read/)
    expect(accentReadabilityWarning('#1a7f37')).toBeNull()
    expect(accentReadabilityWarning('#123')).toBeNull()
    expect(accentReadabilityWarning('not a colour')).toBeNull()
  })

  it('reads an unset accent as the default the site uses', () => {
    expect(effectiveAssistantValue('theme.primary_color', undefined)).toBe('#00dc82')
    expect(ASSISTANT_SETTINGS['theme.primary_color'].screen).toBe('/admin/themes')
  })
})
