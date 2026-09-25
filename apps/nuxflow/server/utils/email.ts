import type { H3Event } from 'h3'
import { ulid } from 'ulid'
import { eq } from 'drizzle-orm'
import { emailLog, sites } from '@nuxflow/db/schema'
import { resolveSetting } from './settings'
import { getEmailBinding } from './cf-env'
import { useDb } from './db'

const HTML_ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => HTML_ESCAPE_MAP[c]!)
}

export type EmailProvider = 'console' | 'cloudflare' | 'resend' | 'brevo' | 'zepto'
export const EMAIL_PROVIDERS: readonly EmailProvider[] = ['console', 'cloudflare', 'resend', 'brevo', 'zepto']

export interface EmailMessage {
  to: string | string[]
  subject: string
  html: string
  text?: string
  /** Overrides the configured From address (e.g. an inbox reply sent from `contact@`). */
  from?: string
  /** Overrides the configured display name. */
  fromName?: string
  replyTo?: string
  /**
   * Extra headers — threading (`In-Reply-To`, `References`) and `List-Unsubscribe`.
   * Cloudflare's binding only accepts its whitelisted headers
   * (https://developers.cloudflare.com/email-service/reference/headers/) and throws
   * E_HEADER_NOT_ALLOWED on anything else, so stick to standard ones.
   */
  headers?: Record<string, string>
  /** Grouping label for email_log ('auth', 'invite', 'notification', 'inbox_reply', …). */
  category?: string
}

export interface EmailConfig {
  emailProvider: string
  fromAddress?: string
  fromName?: string
  resendApiKey?: string
  brevoApiKey?: string
  zeptoApiKey?: string
  domain: string
  /** Attributes the send in email_log; omitted only by callers with no site (tests). */
  siteId?: string
  /** The site's display name, for templates — distinct from fromName, which may be e.g. "Acme Support". */
  siteName?: string
}

export interface SendResult {
  /** Provider-assigned id — Cloudflare's is the RFC Message-ID used for reply threading. */
  messageId?: string
}

interface ResolvedSender { address: string; name?: string }

function resolveSender(msg: EmailMessage, config: EmailConfig): ResolvedSender {
  const address = msg.from ?? (config.fromAddress || `noreply@${config.domain}`)
  const name = (msg.fromName ?? config.fromName)?.trim() || undefined
  return { address, name }
}

/** RFC 5322 `"Name" <addr>` — quotes and backslashes in the name escaped. */
function formatAddress({ address, name }: ResolvedSender): string {
  if (!name) return address
  return `"${name.replace(/["\\]/g, '\\$&')}" <${address}>`
}

function toList(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to]
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await res.json() as Record<string, unknown>
  }
  catch {
    return null
  }
}

async function sendViaResend(msg: EmailMessage, config: EmailConfig): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: formatAddress(resolveSender(msg, config)),
      to: toList(msg.to),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
  const body = await readJson(res)
  return { messageId: typeof body?.id === 'string' ? body.id : undefined }
}

async function sendViaBrevo(msg: EmailMessage, config: EmailConfig): Promise<SendResult> {
  const sender = resolveSender(msg, config)
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: sender.address, ...(sender.name ? { name: sender.name } : {}) },
      to: toList(msg.to).map(e => ({ email: e })),
      ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`Brevo error ${res.status}: ${await res.text()}`)
  const body = await readJson(res)
  return { messageId: typeof body?.messageId === 'string' ? body.messageId : undefined }
}

async function sendViaZepto(msg: EmailMessage, config: EmailConfig): Promise<SendResult> {
  const sender = resolveSender(msg, config)
  const res = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      Authorization: `Zoho-enczapikey ${config.zeptoApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { address: sender.address, ...(sender.name ? { name: sender.name } : {}) },
      to: toList(msg.to).map(e => ({ email_address: { address: e } })),
      ...(msg.replyTo ? { reply_to: [{ address: msg.replyTo }] } : {}),
      ...(msg.headers ? { mime_headers: msg.headers } : {}),
      subject: msg.subject,
      htmlbody: msg.html,
      textbody: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`ZeptoMail error ${res.status}: ${await res.text()}`)
  const body = await readJson(res)
  return { messageId: typeof body?.request_id === 'string' ? body.request_id : undefined }
}

/**
 * Cloudflare's native transactional email binding (`send_email` in wrangler.toml) — no
 * third-party account or API key needed, just `wrangler email sending enable <domain>`
 * for whichever domain `from` uses. This is the recommended provider for NuxFlow sites,
 * since every deployment already has a Cloudflare account by definition.
 *
 * Transactional only — Cloudflare's Email Service terms exclude marketing/bulk mail, so a
 * future newsletter feature must send through a third-party provider, never this one.
 */
async function sendViaCloudflareEmail(msg: EmailMessage, config: EmailConfig, event: H3Event): Promise<SendResult> {
  const email = getEmailBinding(event)
  if (!email) {
    throw new Error('Cloudflare Email Sending is not available — add a send_email binding (name "EMAIL") to wrangler.toml and run `wrangler email sending enable <domain>` for your sending domain.')
  }
  const sender = resolveSender(msg, config)
  const result = await email.send({
    to: msg.to,
    // The binding's runtime validator rejects an EmailAddress object that has `email` but
    // no `name` (the published type marks `name` optional), so only build the object form
    // when there is a display name to put in it.
    from: sender.name ? { email: sender.address, name: sender.name } : sender.address,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
  })
  return { messageId: (result as { messageId?: string } | undefined)?.messageId }
}

async function dispatch(config: EmailConfig, msg: EmailMessage, event: H3Event): Promise<SendResult> {
  switch (config.emailProvider) {
    case 'cloudflare':
      return sendViaCloudflareEmail(msg, config, event)
    case 'resend':
      if (!config.resendApiKey) throw new Error('Resend API key is not configured')
      return sendViaResend(msg, config)
    case 'brevo':
      if (!config.brevoApiKey) throw new Error('Brevo API key is not configured')
      return sendViaBrevo(msg, config)
    case 'zepto':
      if (!config.zeptoApiKey) throw new Error('ZeptoMail API key is not configured')
      return sendViaZepto(msg, config)
    case 'console':
    default:
      console.warn('[email] To:', msg.to, '| Subject:', msg.subject)
      console.warn('[email] Body:', msg.text ?? msg.html)
      return {}
  }
}

/**
 * Best-effort email_log write. Never throws — a logging failure must not turn a delivered
 * email into a reported failure, or mask the real error of a failed one.
 */
async function logEmail(event: H3Event, config: EmailConfig, msg: EmailMessage, outcome: { messageId?: string; error?: string }): Promise<void> {
  if (!config.siteId) return
  try {
    await useDb(event).insert(emailLog).values({
      id: ulid(),
      siteId: config.siteId,
      toAddress: toList(msg.to).join(', ').slice(0, 500),
      subject: msg.subject.slice(0, 500),
      category: msg.category ?? 'general',
      provider: config.emailProvider || 'console',
      status: outcome.error ? 'failed' : 'sent',
      error: outcome.error?.slice(0, 1000) ?? null,
      providerMessageId: outcome.messageId ?? null,
    })
  }
  catch (err) {
    console.error('[email] Failed to write email_log row:', err)
  }
}

export async function sendEmailWithConfig(config: EmailConfig, msg: EmailMessage, event: H3Event): Promise<SendResult> {
  try {
    const result = await dispatch(config, msg, event)
    await logEmail(event, config, msg, { messageId: result.messageId })
    return result
  }
  catch (err) {
    await logEmail(event, config, msg, { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

export async function loadEmailConfig(event: H3Event): Promise<EmailConfig> {
  let host = getHeader(event, 'host')?.split(':')[0] ?? 'nuxflow.app'
  if (host === '127.0.0.1' || host === '::1') {
    host = 'localhost'
  }
  const siteId = event.context.siteId as string | undefined
  // Independent settings lookups — parallelized so a cache-miss (first call per isolate
  // per 30s window) costs one round trip's worth of latency instead of several serialized
  // ones. Fires on every email send (password resets, invites, form notifications), so
  // this is a real per-request hot path, not an admin-only rarity.
  const [emailProvider, fromAddress, fromName, resendApiKey, brevoApiKey, zeptoApiKey, siteName] = await Promise.all([
    resolveSetting(event, 'email.provider', 'emailProvider'),
    resolveSetting(event, 'email.from_address', 'emailFromAddress'),
    resolveSetting(event, 'email.from_name'),
    resolveSetting(event, 'email.resend_api_key', 'resendApiKey'),
    resolveSetting(event, 'email.brevo_api_key', 'brevoApiKey'),
    resolveSetting(event, 'email.zepto_api_key', 'zeptoApiKey'),
    siteId ? getSiteName(event, siteId) : Promise.resolve(''),
  ])

  return {
    emailProvider: emailProvider || 'console',
    fromAddress,
    // An explicit From name wins; otherwise mail goes out under the site's own name
    // ("Acme Bakery <noreply@…>") rather than a bare address, which is both friendlier
    // and better for deliverability.
    fromName: fromName || siteName || undefined,
    resendApiKey,
    brevoApiKey,
    zeptoApiKey,
    domain: host,
    siteId,
    siteName: siteName || undefined,
  }
}

async function getSiteName(event: H3Event, siteId: string): Promise<string> {
  try {
    const site = await useDb(event).query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true } })
    return site?.name ?? ''
  }
  catch {
    return ''
  }
}

export async function sendEmail(event: H3Event, msg: EmailMessage): Promise<SendResult> {
  const config = await loadEmailConfig(event)
  return sendEmailWithConfig(config, msg, event)
}
