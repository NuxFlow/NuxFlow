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

describe('sendEmailWithConfig — sender name, headers, message id', () => {
  it('passes a named sender to the Cloudflare binding as an object, and returns its messageId', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '<m1@acme.test>' })
    const result = await sendEmailWithConfig(
      { emailProvider: 'cloudflare', fromAddress: 'hello@acme.test', fromName: 'Acme Bakery', domain: 'acme.test' },
      { ...msg, headers: { 'In-Reply-To': '<x@y>' } },
      mkEvent({ send }),
    )
    const [sent] = send.mock.calls[0] as [{ from: unknown; headers: Record<string, string> }]
    expect(sent.from).toEqual({ email: 'hello@acme.test', name: 'Acme Bakery' })
    expect(sent.headers).toEqual({ 'In-Reply-To': '<x@y>' })
    expect(result.messageId).toBe('<m1@acme.test>')
  })

  it('lets a per-message from/fromName override the configured sender', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'm2' })
    await sendEmailWithConfig(
      { emailProvider: 'cloudflare', fromAddress: 'noreply@acme.test', fromName: 'Acme', domain: 'acme.test' },
      { ...msg, from: 'contact@acme.test', fromName: 'Acme Support' },
      mkEvent({ send }),
    )
    const [sent] = send.mock.calls[0] as [{ from: unknown }]
    expect(sent.from).toEqual({ email: 'contact@acme.test', name: 'Acme Support' })
  })

  it('quotes the display name for Resend and returns the provider id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 're_123' }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await sendEmailWithConfig(
      { emailProvider: 'resend', resendApiKey: 're_test', fromAddress: 'hi@acme.test', fromName: 'Acme "Best" Co', domain: 'acme.test' },
      msg,
      mkEvent(),
    )
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { from: string }
    expect(body.from).toBe('"Acme \\"Best\\" Co" <hi@acme.test>')
    expect(result.messageId).toBe('re_123')
  })

  it('still reports success when the provider response has no JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('no body') } }))
    await expect(sendEmailWithConfig({ emailProvider: 'resend', resendApiKey: 'k', domain: 'acme.test' }, msg, mkEvent()))
      .resolves.toEqual({ messageId: undefined })
  })

  it('treats a removed/unknown provider value as console rather than failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sendEmailWithConfig({ emailProvider: 'smtp', domain: 'acme.test' }, msg, mkEvent())).resolves.toEqual({})
    warn.mockRestore()
  })
})
