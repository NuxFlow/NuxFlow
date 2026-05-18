import type { H3Event } from 'h3'
import { useDb } from './db'
import { siteSettings } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

const HTML_ESCAPE_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => HTML_ESCAPE_MAP[c]!)
}

interface EmailMessage {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
}

interface EmailConfig {
  emailProvider: string
  fromAddress?: string
  resendApiKey?: string
  brevoApiKey?: string
  zeptoApiKey?: string
  smtpHost?: string
  smtpPort?: string
  smtpUser?: string
  smtpPass?: string
}

const EMAIL_SETTING_KEYS = [
  'email.provider',
  'email.from_address',
  'email.resend_api_key',
  'email.brevo_api_key',
  'email.zepto_api_key',
  'email.smtp_host',
  'email.smtp_port',
  'email.smtp_user',
  'email.smtp_pass',
]

async function loadEmailConfig(event: H3Event): Promise<EmailConfig> {
  const rc = useRuntimeConfig() as Record<string, string>
  const siteId = event.context.siteId as string | undefined

  const dbSettings: Record<string, string> = {}
  if (siteId) {
    try {
      const db = useDb(event)
      const rows = await db.query.siteSettings.findMany({
        where: and(
          eq(siteSettings.siteId, siteId),
          inArray(siteSettings.key, EMAIL_SETTING_KEYS),
        ),
        columns: { key: true, value: true },
      })
      for (const row of rows) {
        if (row.value != null) dbSettings[row.key] = row.value as string
      }
    } catch {
      // Fall through to runtimeConfig only
    }
  }

  const get = (dbKey: string, rcKey: string) =>
    dbSettings[dbKey] || (rc[rcKey] as string | undefined) || ''

  return {
    emailProvider: dbSettings['email.provider'] || rc.emailProvider || 'console',
    fromAddress: dbSettings['email.from_address'] || rc.emailFromAddress || '',
    resendApiKey: get('email.resend_api_key', 'resendApiKey'),
    brevoApiKey: get('email.brevo_api_key', 'brevoApiKey'),
    zeptoApiKey: get('email.zepto_api_key', 'zeptoApiKey'),
    smtpHost: get('email.smtp_host', 'smtpHost'),
    smtpPort: get('email.smtp_port', 'smtpPort'),
    smtpUser: get('email.smtp_user', 'smtpUser'),
    smtpPass: get('email.smtp_pass', 'smtpPass'),
  }
}

async function sendViaResend(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? (config.fromAddress || 'noreply@nuxflow.app')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(msg.to) ? msg.to : [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
}

async function sendViaBrevo(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? (config.fromAddress || 'noreply@nuxflow.app')
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from },
      to: (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => ({ email: e })),
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`Brevo error ${res.status}: ${await res.text()}`)
}

async function sendViaZepto(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? (config.fromAddress || 'noreply@nuxflow.app')
  const res = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      Authorization: `Zoho-enczapikey ${config.zeptoApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { address: from },
      to: (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => ({ email_address: { address: e } })),
      subject: msg.subject,
      htmlbody: msg.html,
      textbody: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`ZeptoMail error ${res.status}: ${await res.text()}`)
}

async function sendViaSmtp(msg: EmailMessage, config: EmailConfig): Promise<void> {
  // SMTP sending via fetch is not possible directly; use a worker-compatible relay.
  // In Cloudflare Workers, use MailChannels (free for Workers) as the SMTP relay.
  const from = msg.from ?? (config.fromAddress || `noreply@${config.smtpHost ?? 'nuxflow.app'}`)
  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => ({ email: e })) }],
      from: { email: from },
      subject: msg.subject,
      content: [
        { type: 'text/html', value: msg.html },
        ...(msg.text ? [{ type: 'text/plain', value: msg.text }] : []),
      ],
    }),
  })
  if (!res.ok && res.status !== 202) throw new Error(`MailChannels error ${res.status}: ${await res.text()}`)
}

export async function sendEmailWithConfig(config: EmailConfig, msg: EmailMessage): Promise<void> {
  switch (config.emailProvider) {
    case 'resend':
      if (!config.resendApiKey) throw new Error('Resend API key is not configured')
      await sendViaResend(msg, config)
      break
    case 'brevo':
      if (!config.brevoApiKey) throw new Error('Brevo API key is not configured')
      await sendViaBrevo(msg, config)
      break
    case 'zepto':
      if (!config.zeptoApiKey) throw new Error('ZeptoMail API key is not configured')
      await sendViaZepto(msg, config)
      break
    case 'smtp':
      await sendViaSmtp(msg, config)
      break
    case 'console':
    default:
      console.warn('[email] To:', msg.to, '| Subject:', msg.subject)
      console.warn('[email] Body:', msg.text ?? msg.html)
      break
  }
}

export async function sendEmail(event: H3Event, msg: EmailMessage): Promise<void> {
  const config = await loadEmailConfig(event)
  await sendEmailWithConfig(config, msg)
}
