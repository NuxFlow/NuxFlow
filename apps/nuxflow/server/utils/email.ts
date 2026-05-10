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
  resendApiKey?: string
  brevoApiKey?: string
  zeptoApiKey?: string
  smtpHost?: string
  smtpPort?: string
  smtpUser?: string
  smtpPass?: string
}

async function sendViaResend(msg: EmailMessage, config: EmailConfig): Promise<void> {
  const from = msg.from ?? 'noreply@nuxflow.app'
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
  const from = msg.from ?? 'noreply@nuxflow.app'
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
  const from = msg.from ?? 'noreply@nuxflow.app'
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
  const from = msg.from ?? `noreply@${config.smtpHost ?? 'nuxflow.app'}`
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

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const config = useRuntimeConfig() as EmailConfig

  switch (config.emailProvider) {
    case 'resend':
      if (!config.resendApiKey) throw new Error('NUXT_RESEND_API_KEY is not set')
      await sendViaResend(msg, config)
      break
    case 'brevo':
      if (!config.brevoApiKey) throw new Error('NUXT_BREVO_API_KEY is not set')
      await sendViaBrevo(msg, config)
      break
    case 'zepto':
      if (!config.zeptoApiKey) throw new Error('NUXT_ZEPTO_API_KEY is not set')
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
