import { SITE_FONTS, isHexColor } from './theme-customizer'

// The admin AI helper ("Ask AI", AdminAssistantPanel). Import-free apart from the
// customizer's font list, so the server (which checks every proposal) and the panel (which
// shows and applies them) read the same rules.
//
// The helper never changes anything itself. It answers, and it may *propose*: a setting
// from the short list below, a change to one of the site's pages (handed to the Canvas
// editor's "Change this page", which has its own preview), or a link to an admin screen.
// The person applies a proposal with the normal save, which records it as AI-assisted.
//
// The list is deliberately small: look and feel, header switches, the homepage's search
// text and the site name. Credentials, the domain, custom HTML, payments, people, plugins,
// backups and deleting things are never on it — those stay for a person to do by hand.

export type AssistantSettingKind = 'select' | 'color' | 'boolean' | 'text'

export interface AssistantSettingDef {
  label: string
  kind: AssistantSettingKind
  /** select: the allowed values and how to show them. */
  options?: ReadonlyArray<{ value: string; label: string }>
  /** text: maximum length. */
  max?: number
  /** For the model: what this setting does. */
  describe: string
  /** Where a person changes it by hand. */
  screen: string
  /** Changes how the site looks, so it gets a live preview. */
  appearance?: boolean
}

const fontOptions = [{ value: 'system', label: 'System font' }, ...SITE_FONTS.map(f => ({ value: f.value, label: f.value }))]

/** `site.name` is the sites table's name column; everything else is a site setting. */
export const ASSISTANT_SETTINGS = {
  'theme.dark_mode': {
    label: 'Light or dark mode',
    kind: 'select',
    options: [{ value: 'auto', label: "Follow the visitor's device" }, { value: 'light', label: 'Always light' }, { value: 'dark', label: 'Always dark' }],
    describe: 'Whether the public site is light, dark, or follows the visitor\'s device',
    screen: '/admin/settings?tab=Appearance',
    appearance: true,
  },
  'theme.primary_color': {
    label: 'Accent colour',
    kind: 'color',
    describe: 'The brand/accent colour used for buttons, links and highlights (a hex colour like #2563eb)',
    screen: '/admin/settings?tab=Appearance',
    appearance: true,
  },
  'theme.font_sans': {
    label: 'Text font',
    kind: 'select',
    options: fontOptions,
    describe: 'The font for body text',
    screen: '/admin/settings?tab=Appearance',
    appearance: true,
  },
  'theme.font_heading': {
    label: 'Heading font',
    kind: 'select',
    options: [{ value: 'same', label: 'Same as the text font' }, ...fontOptions],
    describe: 'The font for headings',
    screen: '/admin/settings?tab=Appearance',
    appearance: true,
  },
  'frontend.show_header': { label: 'Show the site header', kind: 'boolean', describe: 'Show the header with logo and menu on public pages', screen: '/admin/settings?tab=Appearance' },
  'frontend.show_sticky_header': { label: 'Keep the header at the top while scrolling', kind: 'boolean', describe: 'Header stays visible while scrolling', screen: '/admin/settings?tab=Appearance' },
  'frontend.show_search': { label: 'Show the search button', kind: 'boolean', describe: 'A search button in the header', screen: '/admin/settings?tab=Appearance' },
  'frontend.show_reading_time': { label: 'Show reading time on posts', kind: 'boolean', describe: '"5 min read" on posts', screen: '/admin/settings?tab=Appearance' },
  'frontend.show_toc': { label: 'Show a table of contents on posts', kind: 'boolean', describe: 'Contents list on long posts', screen: '/admin/settings?tab=Appearance' },
  'seo.title': { label: 'Homepage search title', kind: 'text', max: 120, describe: 'The homepage title shown in search results', screen: '/admin/seo' },
  'seo.description': { label: 'Homepage search description', kind: 'text', max: 300, describe: 'The homepage description shown in search results', screen: '/admin/seo' },
  'site.name': { label: 'Site name', kind: 'text', max: 100, describe: 'The site\'s name, shown in the header, page titles and emails', screen: '/admin/settings?tab=General' },
} as const satisfies Record<string, AssistantSettingDef>

export type AssistantSettingKey = keyof typeof ASSISTANT_SETTINGS

export function isAssistantSettingKey(key: unknown): key is AssistantSettingKey {
  return typeof key === 'string' && Object.hasOwn(ASSISTANT_SETTINGS, key)
}

export type AssistantSettingValue = string | boolean

/** A proposed value, checked against the setting's rules; undefined when it isn't allowed. */
export function normalizeAssistantSetting(key: AssistantSettingKey, value: unknown): AssistantSettingValue | undefined {
  const def: AssistantSettingDef = ASSISTANT_SETTINGS[key]
  const text = typeof value === 'string' ? value.trim() : typeof value === 'boolean' || typeof value === 'number' ? String(value) : undefined
  if (text === undefined) return undefined
  switch (def.kind) {
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : undefined
    case 'color':
      return isHexColor(text) ? text.toLowerCase() : undefined
    case 'select':
      return def.options?.some(o => o.value === text) ? text : undefined
    case 'text': {
      // One line, no markup: these show up in titles and search results.
      const clean = text.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '')
      return clean && clean.length <= (def.max ?? 200) ? clean : undefined
    }
  }
}

/**
 * What a setting is when it has never been saved: every header switch is on (the public
 * site treats anything but `false` as on), a select is its first option, text is empty.
 */
export function assistantSettingFallback(key: AssistantSettingKey): AssistantSettingValue {
  const def: AssistantSettingDef = ASSISTANT_SETTINGS[key]
  if (def.kind === 'boolean') return true
  if (def.kind === 'select') return def.options?.[0]?.value ?? ''
  return ''
}

/** A stored value as the panel shows it, with the fallback for one never saved. */
export function effectiveAssistantValue(key: AssistantSettingKey, stored: unknown): AssistantSettingValue {
  if (stored === null || stored === undefined || stored === '') return assistantSettingFallback(key)
  if (ASSISTANT_SETTINGS[key].kind === 'boolean') return stored !== false && stored !== 'false'
  return typeof stored === 'string' ? stored : String(stored)
}

/** How a value reads to a person ("Always dark", "Yes", "#2563eb"). */
export function describeAssistantValue(key: AssistantSettingKey, value: AssistantSettingValue | null | undefined): string {
  const def: AssistantSettingDef = ASSISTANT_SETTINGS[key]
  if (value === null || value === undefined || value === '') {
    if (def.kind === 'select') return def.options?.[0]?.label ?? 'Not set'
    return def.kind === 'boolean' ? 'No' : 'Not set'
  }
  if (def.kind === 'boolean') return value === true || value === 'true' ? 'Yes' : 'No'
  if (def.kind === 'select') return def.options?.find(o => o.value === value)?.label ?? String(value)
  return String(value)
}

/**
 * The PATCH /api/v1/settings body that sets these values. `site.name` is the site's own
 * column (`name`); every other key is a setting.
 */
export function assistantSettingsPatch(values: Partial<Record<AssistantSettingKey, AssistantSettingValue>>): { name?: string; settings?: Record<string, AssistantSettingValue> } {
  const out: { name?: string; settings?: Record<string, AssistantSettingValue> } = {}
  for (const [key, value] of Object.entries(values) as [AssistantSettingKey, AssistantSettingValue][]) {
    if (key === 'site.name') out.name = String(value)
    else (out.settings ??= {})[key] = value
  }
  return out
}

// ── What the helper sends back ───────────────────────────────────────────────

export interface AssistantSettingProposal {
  type: 'setting'
  key: AssistantSettingKey
  label: string
  value: AssistantSettingValue
  /** The value now, so the card can show before → after and Undo can put it back. */
  current: AssistantSettingValue
  note: string
}

export interface AssistantPageProposal {
  type: 'page'
  contentId: string
  title: string
  /** What to ask the Canvas editor's "Change this page" for. */
  instruction: string
  note: string
}

export interface AssistantLinkProposal {
  type: 'link'
  to: string
  label: string
  note: string
}

export type AssistantProposal = AssistantSettingProposal | AssistantPageProposal | AssistantLinkProposal

export interface AssistantMessage {
  role: 'user' | 'assistant'
  text: string
}

/** An admin screen the person can open (built from the sidebar for their role). */
export interface AssistantSection {
  label: string
  to: string
}

export interface AssistantResponse {
  reply: string
  proposals: AssistantProposal[]
  /** User-guide sections the answer drew on. */
  sources: string[]
}

export const ASSISTANT_LIMITS = {
  messages: 12,
  messageChars: 2000,
  sections: 120,
  proposals: 6,
} as const
