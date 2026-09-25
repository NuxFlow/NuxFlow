import type { H3Event } from 'h3'
import { escapeHtml, loadEmailConfig, sendEmailWithConfig, type SendResult } from './email'
import { resolveSetting } from './settings'

export interface EmailTemplateInput {
  siteName: string
  /** Hidden inbox-preview line shown after the subject by most clients. */
  preheader?: string
  heading?: string
  /** Plain-text paragraphs — escaped here, never interpreted as HTML. */
  paragraphs: string[]
  action?: { label: string; url: string }
  /** Small grey plain-text note under the action ("If you didn't request this…"). */
  footnote?: string
  /** Hex colour for the button and heading rule; anything else falls back to the default. */
  accentColor?: string
}

const DEFAULT_ACCENT = '#10b981'

function safeAccent(color: string | undefined): string {
  return color && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : DEFAULT_ACCENT
}

function safeUrl(url: string): string {
  // Only http(s) links go into an href — a javascript: URL in an email body is inert in
  // most clients, but not all, and nothing legitimate here ever needs another scheme.
  return /^https?:\/\//i.test(url) ? url : '#'
}

/**
 * The one layout every system email uses (auth, invites, notifications, alerts) — a single
 * centred card with inline styles and a table wrapper, since email clients ignore <style>
 * blocks and flexbox unevenly. Takes plain text only; callers never build HTML, so there's
 * no per-caller escaping to forget. Returns the matching plain-text part as well — sending
 * HTML without a text alternative costs spam score.
 */
export function renderEmailTemplate(input: EmailTemplateInput): { html: string; text: string } {
  const accent = safeAccent(input.accentColor)
  const site = escapeHtml(input.siteName)

  const paragraphs = input.paragraphs
    .map(p => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

  const action = input.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:6px;background:${accent};"><a href="${escapeHtml(safeUrl(input.action.url))}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(input.action.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7280;">Or open this link: <a href="${escapeHtml(safeUrl(input.action.url))}" style="color:${accent};word-break:break-all;">${escapeHtml(input.action.url)}</a></p>`
    : ''

  const footnote = input.footnote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(input.footnote)}</p>`
    : ''

  const heading = input.heading
    ? `<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#111827;">${escapeHtml(input.heading)}</h1>`
    : ''

  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>`
    : ''

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${site}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${accent};">
<tr><td style="padding:32px;">
<p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#6b7280;">${site}</p>
${heading}${paragraphs}${action}${footnote}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">Sent by ${site}</p>
</td></tr></table>
</body></html>`

  const textParts = [
    input.heading,
    ...input.paragraphs,
    input.action ? `${input.action.label}: ${input.action.url}` : undefined,
    input.footnote,
    `— ${input.siteName}`,
  ].filter((p): p is string => !!p)

  return { html, text: textParts.join('\n\n') }
}

export interface TemplatedEmail {
  to: string | string[]
  subject: string
  category?: string
  replyTo?: string
  headers?: Record<string, string>
  template: Omit<EmailTemplateInput, 'siteName' | 'accentColor'>
}

/**
 * sendEmail() with the shared layout applied — site name and the site's primary colour are
 * filled in here, so callers only supply text. Prefer this for every system email.
 */
export async function sendTemplatedEmail(event: H3Event, email: TemplatedEmail): Promise<SendResult> {
  const [config, accentColor] = await Promise.all([
    loadEmailConfig(event),
    resolveSetting(event, 'theme.primary_color'),
  ])
  const { html, text } = renderEmailTemplate({
    ...email.template,
    siteName: config.siteName || config.domain,
    accentColor: typeof accentColor === 'string' ? accentColor : undefined,
  })
  return sendEmailWithConfig(config, {
    to: email.to,
    subject: email.subject,
    html,
    text,
    category: email.category,
    replyTo: email.replyTo,
    headers: email.headers,
  }, event)
}
