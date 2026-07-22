import { describe, it, expect, vi, afterEach } from 'vitest'
import type { H3Event } from 'h3'
import { sendEmailWithConfig, escapeHtml } from '../../server/utils/email'

afterEach(() => {
  vi.unstubAllGlobals()
})

function mkEvent(email?: unknown): H3Event {
  return { context: { cloudflare: email !== undefined ? { env: { EMAIL: email } } : undefined } } as unknown as H3Event
}

const msg = { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<script>"it's"</script> & more`)).toBe(
      '&lt;script&gt;&quot;it&#39;s&quot;&lt;/script&gt; &amp; more',
    )
  })
})

describe('sendEmailWithConfig — console (default)', () => {
  it('logs to console and makes no network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await sendEmailWithConfig({ emailProvider: 'console', domain: 'example.com' }, msg, mkEvent())

    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('sendEmailWithConfig — cloudflare', () => {
  it('throws a clear error when the EMAIL binding is absent', async () => {
    await expect(
      sendEmailWithConfig({ emailProvider: 'cloudflare', domain: 'example.com' }, msg, mkEvent()),
    ).rejects.toThrow(/send_email binding/i)
  })

  it('calls the EMAIL binding with the message when present', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'abc123' })
    const event = mkEvent({ send })

    await sendEmailWithConfig(
      { emailProvider: 'cloudflare', fromAddress: 'hello@example.com', domain: 'example.com' },
      msg,
      event,
    )

    expect(send).toHaveBeenCalledOnce()
    const [sent] = send.mock.calls[0] as [{ to: string; from: string; subject: string }]
    expect(sent.to).toBe('user@example.com')
    expect(sent.from).toBe('hello@example.com')
    expect(sent.subject).toBe('Hello')
  })

  it('falls back to noreply@domain when no from address is configured', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'abc123' })
    const event = mkEvent({ send })

    await sendEmailWithConfig({ emailProvider: 'cloudflare', domain: 'example.com' }, msg, event)

    const [sent] = send.mock.calls[0] as [{ from: string }]
    expect(sent.from).toBe('noreply@example.com')
  })
})

describe('sendEmailWithConfig — resend/brevo/zepto', () => {
  it('throws when the API key is missing', async () => {
    await expect(
      sendEmailWithConfig({ emailProvider: 'resend', domain: 'example.com' }, msg, mkEvent()),
    ).rejects.toThrow(/Resend API key/i)
  })

  it('posts to the Resend API when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await sendEmailWithConfig(
      { emailProvider: 'resend', resendApiKey: 're_test', domain: 'example.com' },
      msg,
      mkEvent(),
    )

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }))
  })
})

describe('sendEmailWithConfig — smtp (MailChannels)', () => {
  it('posts to the MailChannels API regardless of any smtp credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 })
    vi.stubGlobal('fetch', fetchMock)

    await sendEmailWithConfig({ emailProvider: 'smtp', domain: 'example.com' }, msg, mkEvent())

    expect(fetchMock).toHaveBeenCalledWith('https://api.mailchannels.net/tx/v1/send', expect.any(Object))
  })

  it('throws with the response body when MailChannels rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') }))

    await expect(
      sendEmailWithConfig({ emailProvider: 'smtp', domain: 'example.com' }, msg, mkEvent()),
    ).rejects.toThrow(/MailChannels error 401/)
  })
})
