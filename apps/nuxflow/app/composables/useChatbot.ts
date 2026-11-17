import { randomToken } from '#shared/lib/base64'
import { splitLeadMarker, visibleWhileStreaming } from '#shared/lib/chatbot'

/**
 * Talking to the website chatbot (POST /_nuxflow/chat, server/routes/_nuxflow/chat.post.ts),
 * for the public bubble and Admin → Chatbot → Try it. The reply streams in as plain text;
 * the conversation id and source links come back in headers.
 *
 * The browser's identity is a random token in localStorage (never a cookie — any cookie
 * turns the page cache off). The conversation itself is kept in sessionStorage, so it
 * survives moving between pages and is gone when the tab closes. "Try it" keeps nothing.
 */

export interface ChatSourceLink { title: string; path: string | null }

export interface ChatUiMessage {
  role: 'user' | 'assistant'
  text: string
  sources?: ChatSourceLink[]
  /** The reply failed, or the conversation can't go on. */
  error?: boolean
  /** The stored answer's id, for thumbs up/down. */
  id?: string
  rating?: -1 | 1 | null
}

const TOKEN_KEY = 'nuxflow_chat_token'
const SESSION_KEY = 'nuxflow_chat'

function visitorToken(persist: boolean): string {
  if (!persist) return randomToken(24)
  try {
    const existing = localStorage.getItem(TOKEN_KEY)
    if (existing && /^[\w-]{24,128}$/.test(existing)) return existing
    const token = randomToken(24)
    localStorage.setItem(TOKEN_KEY, token)
    return token
  }
  catch {
    return randomToken(24)
  }
}

interface StoredSession { conversationId: string | null; messages: ChatUiMessage[]; leadSent?: boolean }

function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) as StoredSession : null
  }
  catch {
    return null
  }
}

function writeSession(state: StoredSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...state, messages: state.messages.slice(-60) }))
  }
  catch {
    // Storage blocked: the chat still works, it just won't survive a page change.
  }
}

function errorInfo(body: unknown, status: number): { message: string; code?: string } {
  const b = (body ?? {}) as { message?: string; statusMessage?: string; data?: { code?: string } }
  const fallback = status === 429 ? 'Too many messages — please wait a moment.' : 'Sorry, something went wrong. Please try again.'
  return { message: b.message || b.statusMessage || fallback, code: b.data?.code }
}

export function useChatbot(opts: { test?: boolean } = {}) {
  const persist = !opts.test
  const token = import.meta.client ? visitorToken(persist) : ''
  const stored = import.meta.client && persist ? readSession() : null

  const messages = ref<ChatUiMessage[]>(stored?.messages ?? [])
  const conversationId = ref<string | null>(stored?.conversationId ?? null)
  const sending = ref(false)
  /** The bot asked to take the visitor's details (it couldn't help, or they asked for a person). */
  const wantsLead = ref(false)
  /** The conversation can't go on: its message limit, or the site's chat allowance is used up. */
  const stopped = ref<null | 'limit' | 'paused'>(null)
  const leadSent = ref(stored?.leadSent ?? false)
  /** The server wants a (new) Turnstile token. */
  const needsTurnstile = ref(false)

  function save() {
    if (persist) writeSession({ conversationId: conversationId.value, messages: messages.value, leadSent: leadSent.value })
  }

  async function send(text: string, extra: { path?: string; turnstileToken?: string } = {}): Promise<void> {
    const message = text.trim()
    if (!message || sending.value) return
    sending.value = true
    wantsLead.value = false
    needsTurnstile.value = false
    messages.value.push({ role: 'user', text: message })
    const reply: ChatUiMessage = reactive({ role: 'assistant', text: '' })
    messages.value.push(reply)
    try {
      const res = await fetch('/_nuxflow/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'message',
          token,
          conversationId: conversationId.value ?? undefined,
          message,
          path: extra.path ?? '/',
          turnstileToken: extra.turnstileToken,
          test: opts.test || undefined,
        }),
      })
      if (!res.ok || !res.body) {
        const info = errorInfo(await res.json().catch(() => null), res.status)
        if (info.code === 'chat_limit') stopped.value = 'limit'
        if (info.code === 'plan_limit' || info.code === 'platform_ai_cap') stopped.value = 'paused'
        if (info.code === 'turnstile') needsTurnstile.value = true
        reply.text = info.code === 'plan_limit' || info.code === 'platform_ai_cap'
          ? 'The chat is taking a break right now.'
          : info.message
        reply.error = true
        if (stopped.value) wantsLead.value = true
        return
      }
      conversationId.value = res.headers.get('x-chat-conversation') || conversationId.value
      reply.id = res.headers.get('x-chat-message') || undefined
      let sources: ChatSourceLink[] = []
      try {
        sources = JSON.parse(decodeURIComponent(res.headers.get('x-chat-sources') || '%5B%5D')) as ChatSourceLink[]
      }
      catch {
        sources = []
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        full += decoder.decode(value, { stream: true })
        reply.text = visibleWhileStreaming(full)
      }
      full += decoder.decode()
      const final = splitLeadMarker(full)
      reply.text = final.text.trim() || 'Sorry, I couldn\'t answer that just now. Please try again.'
      if (!final.text.trim()) reply.error = true
      if (sources.length) reply.sources = sources
      if (final.wantsLead) wantsLead.value = true
    }
    catch {
      reply.text = 'Sorry, the connection dropped. Please try again.'
      reply.error = true
    }
    finally {
      sending.value = false
      save()
    }
  }

  async function sendLead(lead: { name: string; email: string; phone?: string; message?: string; website?: string }, extra: { path?: string; turnstileToken?: string } = {}): Promise<void> {
    const res = await $fetch<{ ok: boolean; conversationId?: string }>('/_nuxflow/chat', {
      method: 'POST',
      body: { action: 'lead', token, conversationId: conversationId.value ?? undefined, path: extra.path ?? '/', turnstileToken: extra.turnstileToken, ...lead },
    })
    if (res.conversationId) conversationId.value = res.conversationId
    leadSent.value = true
    wantsLead.value = false
    save()
  }

  /** Thumbs on an answer; the same thumb again takes it back. Never throws. */
  async function rate(message: ChatUiMessage, rating: -1 | 1): Promise<void> {
    if (!message.id || !conversationId.value) return
    const next = message.rating === rating ? null : rating
    const before = message.rating ?? null
    message.rating = next
    try {
      await $fetch<{ ok: boolean }>('/_nuxflow/chat', { method: 'POST', body: { action: 'rate', token, conversationId: conversationId.value, messageId: message.id, rating: next ?? 0 } })
    }
    catch {
      message.rating = before
    }
    save()
  }

  function reset() {
    messages.value = []
    conversationId.value = null
    wantsLead.value = false
    stopped.value = null
    leadSent.value = false
    save()
  }

  return { messages, conversationId, sending, wantsLead, stopped, leadSent, needsTurnstile, send, sendLead, rate, reset }
}
