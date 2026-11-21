import { describe, it, expect } from 'vitest'
import {
  CUSTOMIZER_DEFAULTS,
  DARK_ON_ACCENT,
  ON_PRIMARY_BUTTON_CSS,
  accentReadabilityCss,
  accentTextCss,
  readableAccentText,
  contrastRatio,
  readableTextOn,
  appearanceCss,
  customizerCss,
  parseCustomizerValues,
  primaryPaletteDeclarations,
  siteFontsHref,
} from '../../shared/lib/theme-customizer'
import { spacingToCss } from '../../../../packages/canvas/src/utils/spacing'
import { readStoredCustomizerValues } from '../../server/utils/theme-customizer'

describe('parseCustomizerValues', () => {
  it('fills every field from defaults for empty or junk input', () => {
    expect(parseCustomizerValues(undefined)).toEqual(CUSTOMIZER_DEFAULTS)
    expect(parseCustomizerValues('nope')).toEqual(CUSTOMIZER_DEFAULTS)
    expect(parseCustomizerValues({ fontSize: 'huge', headingFont: 'Comic Sans', bgDark: 'black' })).toEqual(CUSTOMIZER_DEFAULTS)
  })

  it('keeps only hex colours, lower-cased', () => {
    const v = parseCustomizerValues({ primaryColor: '#ABCDEF', linkColor: 'red;}x{', bgLight: '#FFF' })
    expect(v).toMatchObject({ primaryColor: '#abcdef', linkColor: '', bgLight: '#fff' })
  })

  it('maps values from older versions across', () => {
    expect(parseCustomizerValues({ borderRadius: 'full', contentWidth: 'full' })).toMatchObject({ borderRadius: 'xl', contentWidth: 'wide' })
  })
})

describe('customizerCss', () => {
  it('writes no rules for the defaults, so the base theme is left as it was', () => {
    expect(customizerCss(CUSTOMIZER_DEFAULTS)).toBe('/* NuxFlow Visual Customizer */')
  })

  it('targets what the site really renders', () => {
    const css = customizerCss(parseCustomizerValues({
      linkColor: '#112233',
      bgLight: '#fafafa',
      bgDark: '#0f172a',
      fontSize: 'lg',
      lineHeight: 'relaxed',
      headingWeight: '600',
      borderRadius: 'none',
      spacing: 'compact',
      contentWidth: 'narrow',
    }))
    expect(css).toContain(':root{--ui-radius:0rem;--nuxflow-spacing-scale:0.6;--nuxflow-link:#112233}')
    expect(css).toContain('.mesh-bg{background-color:#fafafa}')
    expect(css).toContain('.dark .mesh-bg,.mesh-bg.dark{background-color:#0f172a}')
    expect(css).toContain('body,.nux-content,.prose{font-size:1.0625rem;line-height:1.9}')
    expect(css).toContain('.prose{--tw-prose-links:var(--nuxflow-link)')
    expect(css).toMatch(/\.nux-content h1,\.prose h1.*\{font-weight:600\}/)
    expect(css).toContain('.nux-article{max-width:42rem}')
  })

  it('never contains @import or url() (the sanitizer would strip them)', () => {
    const css = customizerCss(parseCustomizerValues({ bodyFont: 'Lora', headingFont: 'Inter', borderRadius: 'lg' }))
    expect(css).not.toMatch(/@import|url\(/)
  })
})

describe('appearanceCss', () => {
  it('recolours Nuxt UI\'s palette from the accent colour', () => {
    const css = appearanceCss({ primaryColor: '#3b82f6', bodyFont: 'system', headingFont: 'same' })
    expect(css).toContain('--nuxflow-primary:#3b82f6')
    expect(css).toContain('--ui-color-primary-500:#3b82f6')
    expect(css).toContain('--ui-color-primary-950:color-mix(in oklab,#3b82f6 28%,black)')
    expect(primaryPaletteDeclarations('#000')).toHaveLength(11)
  })

  it('drops an unsafe colour', () => {
    expect(appearanceCss({ primaryColor: 'red;}</style>', bodyFont: 'system', headingFont: 'same' })).toBe('')
  })

  it('sets body and heading fonts only when they differ from the default', () => {
    expect(appearanceCss({ primaryColor: '', bodyFont: 'system', headingFont: 'same' })).toBe('')
    expect(appearanceCss({ primaryColor: '', bodyFont: 'system', headingFont: 'system' })).toBe('')
    const css = appearanceCss({ primaryColor: '', bodyFont: 'Inter', headingFont: 'system' })
    expect(css).toContain('body{font-family:var(--nuxflow-font)}')
    expect(css).toContain('--nuxflow-heading-font:system-ui')
    expect(css).toContain('h1,h2,h3,h4,h5,h6{font-family:var(--nuxflow-heading-font)}')
  })
})

describe('siteFontsHref', () => {
  it('builds one stylesheet for the offered fonts and skips the rest', () => {
    expect(siteFontsHref(['system', 'same', 'Nope'])).toBeNull()
    const href = siteFontsHref(['Lora', 'Lora', 'Inter'])!
    expect(href.startsWith('https://fonts.googleapis.com/css2?family=Lora:')).toBe(true)
    expect(href).toContain('&family=Inter:')
    expect(href.match(/family=Lora/g)).toHaveLength(1)
    expect(href.endsWith('&display=swap')).toBe(true)
  })
})

describe('readStoredCustomizerValues', () => {
  it('reads both the object form and the older JSON-string form', () => {
    expect(readStoredCustomizerValues({ spacing: 'compact' })).toEqual({ spacing: 'compact' })
    expect(readStoredCustomizerValues('{"spacing":"compact"}')).toEqual({ spacing: 'compact' })
    expect(readStoredCustomizerValues('{bad')).toEqual({})
    expect(readStoredCustomizerValues(['x'])).toEqual({})
  })
})

describe('spacingToCss', () => {
  const S = 'var(--nuxflow-spacing-scale, 1)'

  it('scales the top and bottom of a block\'s own padding by the site spacing scale', () => {
    expect(spacingToCss({ top: 40, right: 24, bottom: 0, left: 24, unit: 'px' }, '80px 24px'))
      .toBe(`calc(40px * ${S}) 24px 0px 24px`)
  })

  it('scales a default shorthand of 1–4 values', () => {
    expect(spacingToCss(null, '80px 24px')).toBe(`calc(80px * ${S}) 24px calc(80px * ${S}) 24px`)
    expect(spacingToCss(undefined, '24px')).toBe(`calc(24px * ${S}) 24px calc(24px * ${S}) 24px`)
    expect(spacingToCss(undefined, '48px 24px 24px 24px')).toBe(`calc(48px * ${S}) 24px calc(24px * ${S}) 24px`)
    expect(spacingToCss(undefined, '1px 2px 3px')).toBe(`calc(1px * ${S}) 2px calc(3px * ${S}) 2px`)
  })

  it('keeps an empty default empty', () => {
    expect(spacingToCss(null, '')).toBe('')
  })
})

describe('readable text on the accent colour', () => {
  it('measures contrast the WCAG way', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('picks dark text on light accents and white on dark ones', () => {
    expect(readableTextOn('#00dc82')).toBe(DARK_ON_ACCENT) // the default green: white was 1.8:1
    expect(readableTextOn('#ffeb3b')).toBe(DARK_ON_ACCENT)
    expect(readableTextOn('#1d4ed8')).toBe('#ffffff')
    expect(readableTextOn('#123')).toBe('#ffffff')
  })

  it('never leaves accent buttons below 3:1, whatever the colour', () => {
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
      const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
      expect(contrastRatio(hex, readableTextOn(hex))).toBeGreaterThanOrEqual(3)
    }
  })

  it('writes the text colour with the accent; Nuxt UI solid buttons read it in light mode', () => {
    const css = appearanceCss({ primaryColor: '#00dc82', bodyFont: 'system', headingFont: 'same' })
    expect(css).toContain(`--nuxflow-on-primary:${DARK_ON_ACCENT}`)
    // Defaults still write nothing; the button rule is separate and always on public pages.
    expect(appearanceCss({ primaryColor: '', bodyFont: 'system', headingFont: 'same' })).toBe('')
    expect(ON_PRIMARY_BUTTON_CSS).toBe(':root:not(.dark) .bg-primary.text-inverted{color:var(--nuxflow-on-primary,#0f172a)}')
  })
})

describe('readable accent text on white', () => {
  it('keeps an accent that already reads well, and darkens a light one just enough', () => {
    expect(readableAccentText('#1D4ED8')).toBe('#1d4ed8')
    const green = readableAccentText('#00dc82')
    expect(contrastRatio(green, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    // Just enough: one step lighter would fail.
    const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(green.slice(i, i + 2), 16))
    expect(g! / 0xDC).toBeGreaterThan(0.4)
    expect(r).toBe(0)
    expect(b! / 0x82).toBeCloseTo(g! / 0xDC, 1)
  })

  it('gives every colour readable text', () => {
    for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) {
      const hex = `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
      expect(contrastRatio(readableAccentText(hex), '#ffffff')).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('writes a light-mode text rule only when the accent needs one', () => {
    expect(accentTextCss('#1d4ed8')).toBe('')
    expect(accentTextCss('#00dc82')).toBe(`:root:not(.dark) :is(.text-primary,.text-primary-400,.text-primary-500,.text-primary-600,.text-primary-700){color:${readableAccentText('#00dc82')}}`)
    // No accent chosen: Nuxt UI's own darker shade.
    expect(accentTextCss('')).toContain('{color:var(--ui-color-primary-700)}')
    expect(accentReadabilityCss('#00dc82')).toBe(ON_PRIMARY_BUTTON_CSS + accentTextCss('#00dc82'))
  })
})
