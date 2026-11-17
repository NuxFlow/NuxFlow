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
  /** Live details it may look up for an answer (read at the moment it answers). */
  live: {
    /** The next few upcoming public events. */
    events: boolean
    /** Price and stock of products it found pages for. */
    products: boolean
    /** The next free times of appointment services on pages it found. */
    appointments: boolean
  }
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
  live: { events: true, products: true, appointments: true },
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
  if (!raw || typeof raw !== 'object') return { ...d, live: { ...d.live }, lead: { ...d.lead } }
  const r = raw as Record<string, unknown>
  const lead = (r.lead && typeof r.lead === 'object' ? r.lead : {}) as Record<string, unknown>
  const live = (r.live && typeof r.live === 'object' ? r.live : {}) as Record<string, unknown>
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
    live: {
      events: live.events !== false,
      products: live.products !== false,
      appointments: live.appointments !== false,
    },
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
 * bubble then offers the lead form (when leads are on), and the answer is listed in
 * Admin → Chatbot → Insights as one it couldn't help with. A marker rather than a tool call because the models it
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
/** Uploaded documents are longer than pages: a price list or handbook. */
export const MAX_CHUNKS_PER_DOCUMENT = 120

/**
 * Splits a page's text into chunks, on paragraph boundaries where possible. Each chunk
 * starts with the page's title so it makes sense on its own. Blank input = no chunks.
 */
export function chunkText(title: string, body: string, maxChars = CHUNK_CHARS, maxChunks = MAX_CHUNKS_PER_SOURCE): string[] {
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
  const out = chunks.slice(0, maxChunks).map(c => (heading ? `${heading}\n\n${c}` : c))
  // A page with a title but no body still says something (e.g. "Opening times").
  if (!out.length && heading) return [heading]
  return out
}

export type ChatKnowledgeKind = 'faq' | 'text' | 'document'

/** The text a knowledge entry is learnt as. */
export function knowledgeText(kind: ChatKnowledgeKind, title: string, body: string): { title: string; body: string } {
  return kind === 'faq'
    ? { title: `Q: ${title.trim()}`, body: `A: ${body.trim()}` }
    : { title: title.trim(), body: body.trim() }
}

// ── Documents ─────────────────────────────────────────────────────────────────────────

export const CHAT_DOCUMENT_LIMITS = {
  /** Largest file accepted. */
  bytes: 10 * 1024 * 1024,
  /** Most text kept from one document (the rest is cut off, and the admin told). */
  chars: 150_000,
  /** Knowledge entries' own text (Q&A answers and free text). */
  entryChars: 4000,
} as const

/**
 * Files turned into text for the chatbot. Plain text is read as it is; the rest needs
 * Workers AI's document conversion (`env.AI.toMarkdown()`, free for these formats).
 * No images: converting those runs an AI model, and their text is rarely what's wanted.
 */
export const CHAT_DOCUMENT_TYPES: Record<string, { label: string; plain: boolean }> = {
  txt: { label: 'Text', plain: true },
  md: { label: 'Markdown', plain: true },
  csv: { label: 'CSV', plain: true },
  pdf: { label: 'PDF', plain: false },
  docx: { label: 'Word', plain: false },
  odt: { label: 'OpenDocument text', plain: false },
  xlsx: { label: 'Excel', plain: false },
  ods: { label: 'OpenDocument spreadsheet', plain: false },
  html: { label: 'Web page', plain: false },
}

export function chatDocumentExtension(fileName: string): string | null {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  return ext in CHAT_DOCUMENT_TYPES ? ext : null
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
  kind: ChatKnowledgeKind
  title: string
  body: string
  enabled: boolean
  fileName: string | null
  fileSize: number | null
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
  unanswered: boolean
  rating: number | null
  createdAt: string
}

/** Admin → Chatbot → Insights: how the last 30 days went, and the answers that need a look. */
export interface ChatInsightsResponse {
  totals: {
    conversations: number
    questions: number
    leads: number
    helpful: number
    unhelpful: number
    unanswered: number
  }
  /** Not yet dealt with, newest first. */
  items: ChatInsightItem[]
}

export interface ChatInsightItem {
  /** The bot's answer. */
  messageId: string
  conversationId: string
  question: string
  answer: string
  reason: 'unanswered' | 'unhelpful'
  createdAt: string
}
