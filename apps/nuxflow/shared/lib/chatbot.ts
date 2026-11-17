// The website chatbot's settings and the small pure rules shared by the server and the
// admin/bubble UI (server/utils/chatbot*.ts). Import-free.

/** The one JSON site setting holding the chatbot's configuration (saved via the settings PATCH). */
export const CHATBOT_SETTING_KEY = 'chatbot.settings'

export type ChatLeadMode = 'fallback' | 'always' | 'off'

export interface ChatbotSettings {
  enabled: boolean
  /** Shown in the bubble's header. */
  name: string
  greeting: string
  /** The admin's own instructions: tone, what to push, what to say about prices… */
  instructions: string
  /** Topics the bot must not discuss, one per line. */
  avoid: string
  /** true = only answer from the site's own information; false = may use general knowledge too. */
  strict: boolean
  /** 'visitor' = reply in the language the visitor writes in; 'site' = always the site's language. */
  language: 'visitor' | 'site'
  /** Content type slugs the bot learns from. Empty = every type. */
  contentTypes: string[]
  /** Pages (path prefixes) where the bubble isn't shown. */
  excludePaths: string[]
  /** Up to four questions offered before the visitor types anything. */
  starterQuestions: string[]
  /** Show links to the pages an answer came from. */
  showSources: boolean
  /** Visitor messages allowed in one conversation. */
  maxMessages: number
  lead: {
    /** fallback = offer to take details when it can't help; always = also a button at all times; off = never. */
    mode: ChatLeadMode
    askPhone: boolean
    /** Shown next to the form, e.g. "We'll only use this to reply to you." */
    consentText: string
  }
}

export const CHATBOT_LIMITS = {
  name: 60,
  greeting: 500,
  instructions: 3000,
  avoid: 1000,
  starterQuestions: 4,
  starterQuestion: 120,
  excludePaths: 50,
  minMessages: 2,
  maxMessages: 50,
  consentText: 500,
  /** Longest message a visitor may send. */
  message: 1000,
} as const

export const DEFAULT_CHATBOT_SETTINGS: ChatbotSettings = {
  enabled: false,
  name: 'Assistant',
  greeting: 'Hi! Ask me anything about us — I answer from this website.',
  instructions: '',
  avoid: '',
  strict: true,
  language: 'visitor',
  contentTypes: [],
  excludePaths: [],
  starterQuestions: [],
  showSources: true,
  maxMessages: 20,
  lead: {
    mode: 'fallback',
    askPhone: false,
    consentText: 'We\'ll only use your details to reply to you.',
  },
}

function str(value: unknown, fallback: string, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function strList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)
}

/** Reads a stored value leniently, field by field — anything missing or wrong takes the default. */
export function parseChatbotSettings(raw: unknown): ChatbotSettings {
  const d = DEFAULT_CHATBOT_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d, lead: { ...d.lead } }
  const r = raw as Record<string, unknown>
  const lead = (r.lead && typeof r.lead === 'object' ? r.lead : {}) as Record<string, unknown>
  const max = Number(r.maxMessages)
  return {
    enabled: r.enabled === true,
    name: str(r.name, d.name, CHATBOT_LIMITS.name).trim() || d.name,
    greeting: str(r.greeting, d.greeting, CHATBOT_LIMITS.greeting),
    instructions: str(r.instructions, d.instructions, CHATBOT_LIMITS.instructions),
    avoid: str(r.avoid, d.avoid, CHATBOT_LIMITS.avoid),
    strict: r.strict !== false,
    language: r.language === 'site' ? 'site' : 'visitor',
    contentTypes: strList(r.contentTypes, 50, 40).filter(s => /^[a-z][a-z0-9-]{0,39}$/.test(s)),
    excludePaths: strList(r.excludePaths, CHATBOT_LIMITS.excludePaths, 200),
    starterQuestions: strList(r.starterQuestions, CHATBOT_LIMITS.starterQuestions, CHATBOT_LIMITS.starterQuestion),
    showSources: r.showSources !== false,
    maxMessages: Number.isInteger(max) ? Math.min(CHATBOT_LIMITS.maxMessages, Math.max(CHATBOT_LIMITS.minMessages, max)) : d.maxMessages,
    lead: {
      mode: lead.mode === 'always' || lead.mode === 'off' ? lead.mode : 'fallback',
      askPhone: lead.askPhone === true,
      consentText: str(lead.consentText, d.lead.consentText, CHATBOT_LIMITS.consentText),
    },
  }
}

/** What the bubble needs (GET /api/public/site). The admin's instructions stay on the server. */
export interface PublicChatbotSettings {
  name: string
  greeting: string
  starterQuestions: string[]
  showSources: boolean
  excludePaths: string[]
  lead: ChatbotSettings['lead']
}

export function publicChatbotSettings(s: ChatbotSettings): PublicChatbotSettings | null {
  if (!s.enabled) return null
  return {
    name: s.name,
    greeting: s.greeting,
    starterQuestions: s.starterQuestions,
    showSources: s.showSources,
    excludePaths: s.excludePaths,
    lead: s.lead,
  }
}

// Pages the bubble is never shown on, whatever the settings say.
const NEVER_ON = ['/admin', '/account', '/login', '/register', '/forgot-password', '/reset-password', '/setup', '/authorize', '/checkout']

function underPrefix(path: string, prefixes: string[]): boolean {
  const p = path.toLowerCase().replace(/\/+$/, '') || '/'
  return prefixes.some((raw) => {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === '/') return p === '/'
    const prefix = trimmed.replace(/\/+$/, '')
    if (!prefix) return false
    const normalized = prefix.startsWith('/') ? prefix : `/${prefix}`
    return p === normalized || p.startsWith(`${normalized}/`)
  })
}

/** Should the bubble show on this page? */
export function chatbotShownOn(path: string, excludePaths: string[]): boolean {
  return !underPrefix(path, NEVER_ON) && !underPrefix(path, excludePaths)
}

// ── Lead marker ───────────────────────────────────────────────────────────────────────

/**
 * The bot ends a reply with this when it can't help or the visitor asks for a person; the
 * bubble then offers the lead form. A marker rather than a tool call because the models it
 * runs on (Workers AI's small fast model included) follow it reliably, and it streams.
 */
export const LEAD_MARKER = '[[CONTACT]]'

/** The reply without the marker, and whether it was there. */
export function splitLeadMarker(text: string): { text: string; wantsLead: boolean } {
  const wantsLead = text.includes(LEAD_MARKER)
  return { text: wantsLead ? text.split(LEAD_MARKER).join('').trimEnd() : text, wantsLead }
}

/**
 * For showing a reply while it streams in: hides the marker, and a trailing partial one
 * (`[[CON`) so it never flashes up on screen.
 */
export function visibleWhileStreaming(text: string): string {
  const { text: clean } = splitLeadMarker(text)
  for (let i = Math.min(LEAD_MARKER.length - 1, clean.length); i > 0; i--) {
    if (LEAD_MARKER.startsWith(clean.slice(-i))) return clean.slice(0, -i)
  }
  return clean
}

// ── Chunking ──────────────────────────────────────────────────────────────────────────

/** About 300 tokens of English per chunk — small enough to retrieve precisely. */
export const CHUNK_CHARS = 1200
/** Most chunks one page may produce (a very long page is cut short rather than costing hundreds). */
export const MAX_CHUNKS_PER_SOURCE = 40

/**
 * Splits a page's text into chunks, on paragraph boundaries where possible. Each chunk
 * starts with the page's title so it makes sense on its own. Blank input = no chunks.
 */
export function chunkText(title: string, body: string, maxChars = CHUNK_CHARS): string[] {
  const paragraphs = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const pieces: string[] = []
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      pieces.push(p)
      continue
    }
    // A paragraph longer than a chunk: split at sentence ends, then hard-cut what's left.
    let rest = p
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars)
      const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '), window.lastIndexOf('\n'))
      const at = cut > maxChars / 2 ? cut + 1 : maxChars
      pieces.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    if (rest) pieces.push(rest)
  }

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > maxChars) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n\n${piece}` : piece
  }
  if (current) chunks.push(current)

  const heading = title.trim()
  const out = chunks.slice(0, MAX_CHUNKS_PER_SOURCE).map(c => (heading ? `${heading}\n\n${c}` : c))
  // A page with a title but no body still says something (e.g. "Opening times").
  if (!out.length && heading) return [heading]
  return out
}

/** The text a knowledge entry is learnt as. */
export function knowledgeText(kind: 'faq' | 'text', title: string, body: string): { title: string; body: string } {
  return kind === 'faq'
    ? { title: `Q: ${title.trim()}`, body: `A: ${body.trim()}` }
    : { title: title.trim(), body: body.trim() }
}

/** The Vectorize namespace a site's chatbot knowledge lives in (smart search uses the bare site id). */
export function chatNamespace(siteId: string): string {
  return `chat:${siteId}`
}

// ── Admin API shapes ──────────────────────────────────────────────────────────────────

export interface ChatbotIndexStatus {
  /** Pages and knowledge entries learnt / still to learn. */
  learnt: number
  pending: number
  chunks: number
  /** False when the deployment has no Vectorize index or AI binding: the bot then only knows the business details. */
  indexAvailable: boolean
}

export interface ChatbotStatusResponse {
  settings: ChatbotSettings
  /** False when the hosting plan doesn't include the chatbot. */
  planIncluded: boolean
  /** Whether any AI is available at all (Workers AI binding or a key). */
  aiAvailable: boolean
  index: ChatbotIndexStatus
  /** Whether Turnstile protects the first message (the site key and the deployment secret are both set). */
  turnstile: boolean
}

export interface ChatKnowledgeEntry {
  id: string
  kind: 'faq' | 'text'
  title: string
  body: string
  enabled: boolean
  updatedAt: string
}

export interface ChatConversationSummary {
  id: string
  pagePath: string
  messageCount: number
  firstMessage: string
  leadName: string | null
  leadEmail: string | null
  inboxThreadId: string | null
  createdAt: string
  lastMessageAt: string
}

export interface ChatTranscriptMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources: { title: string; path: string | null }[] | null
  createdAt: string
}
