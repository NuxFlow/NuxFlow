import type { H3Event } from 'h3'
import { resolveSetting } from './settings'
import { getEmailBinding } from './cf-env'

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
  replyTo?: string
}

interface EmailConfig {
  emailProvider: string
  fromAddress?: string
  resendApiKey?: string
  brevoApiKey?: string
  zeptoApiKey?: string
  domain: string
}

async function loadEmailConfig(event: H3Event): Promise<EmailConfig> {
  let host = getHeader(event, 'host')?.split(':')[0] ?? 'nuxflow.app'
  if (host === '127.0.0.1' || host === '::1') {
    host = 'localhost'
  }
  return {
    emailProvider: await resolveSetting(event, 'email.provider', 'emailProvider') || 'console',
    fromAddress: await resolveSetting(event, 'email.from_address', 'emailFromAddress'),
    resendApiKey: await resolveSetting(event, 'email.resend_api_key', 'resendApiKey'),
    brevoApiKey: await resolveSetting(event, 'email.brevo_api_key', 'brevoApiKey'),
    zeptoApiKey: await resolveSetting(event, 'email.zepto_api_key', 'zeptoApiKey'),
    domain: host,
  }
}

async function sendViaResend(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? (config.fromAddress || `noreply@${config.domain}`)
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
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`)
}

async function sendViaBrevo(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? (config.fromAddress || `noreply@${config.domain}`)
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from },
      to: (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => ({ email: e })),
      ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`Brevo error ${res.status}: ${await res.text()}`)
}

async function sendViaZepto(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? (config.fromAddress || `noreply@${config.domain}`)
  const res = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      Authorization: `Zoho-enczapikey ${config.zeptoApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { address: from },
      to: (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => ({ email_address: { address: e } })),
      ...(msg.replyTo ? { reply_to: { address: msg.replyTo } } : {}),
      subject: msg.subject,
      htmlbody: msg.html,
      textbody: msg.text,
    }),
  })
  if (!res.ok) throw new Error(`ZeptoMail error ${res.status}: ${await res.text()}`)
}

async function sendViaMailChannels(msg: EmailMessage, config: EmailConfig): Promise<void> {
  // MailChannels' free anonymous relay for Cloudflare Workers was shut down for new
  // customers in mid-2024 — using this now requires an existing MailChannels account
  // relationship and DNS domain-lockdown records, which most self-hosters won't have.
  // It does NOT use config.smtpHost/smtpUser/smtpPass — MailChannels has no concept of
  // user-supplied SMTP credentials, it authorizes purely via the sending domain's DNS.
  // Prefer the 'cloudflare' provider (sendViaCloudflareEmail below) instead — it needs
  // no third-party account, just `wrangler email sending enable <domain>`.
  const from = msg.from ?? (config.fromAddress || `noreply@${config.domain}`)
  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: (Array.isArray(msg.to) ? msg.to : [msg.to]).map(e => ({ email: e })) }],
      from: { email: from },
      ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
      subject: msg.subject,
      content: [
        { type: 'text/html', value: msg.html },
        ...(msg.text ? [{ type: 'text/plain', value: msg.text }] : []),
      ],
    }),
  })
  if (!res.ok && res.status !== 202) throw new Error(`MailChannels error ${res.status}: ${await res.text()}`)
}

/**
 * Cloudflare's native transactional email binding (`send_email` in wrangler.toml) — no
 * third-party account or API key needed, just `wrangler email sending enable <domain>`
 * for whichever domain `from` uses. This is the recommended provider for NuxFlow sites,
 * since every deployment already has a Cloudflare account by definition.
 */
async function sendViaCloudflareEmail(msg: EmailMessage, config: EmailConfig, event: H3Event): Promise<void> {
  const email = getEmailBinding(event)
  if (!email) {
    throw new Error('Cloudflare Email Sending is not available — add a send_email binding (name "EMAIL") to wrangler.toml and run `wrangler email sending enable <domain>` for your sending domain.')
  }
  const from = msg.from ?? (config.fromAddress || `noreply@${config.domain}`)
  await email.send({
    to: msg.to,
    from: { email: from },
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
  })
}

export async function sendEmailWithConfig(config: EmailConfig, msg: EmailMessage, event: H3Event): Promise<void> {
  switch (config.emailProvider) {
    case 'cloudflare':
      await sendViaCloudflareEmail(msg, config, event)
      break
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
      await sendViaMailChannels(msg, config)
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
  await sendEmailWithConfig(config, msg, event)
}
