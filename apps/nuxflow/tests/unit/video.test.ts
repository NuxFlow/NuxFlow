import { describe, it, expect, vi, afterEach } from 'vitest'
import { isStreamPlayerUrl, parseVideoUrl, streamEmbedUrl, videoEmbedUrl, videoThumbnailUrl, findVideoBlocks, findVideoEmbeds, parseVideoList, videoBackgroundUrl } from '@nuxflow/canvas/video'
import { renderTipTap } from '../../shared/lib/render-tiptap'
import { contentToMarkdown } from '../../server/utils/markdown'
import { buildPageJsonLd } from '../../app/utils/seo'
import { TUS_CHUNK_BYTES, useVideoUploadXhr } from '../../app/composables/useVideoUploadXhr'
import { tusMetadata, streamCustomerCode, signStreamToken } from '../../server/utils/stream'
import { isoDateTime, isoDuration } from '../../server/utils/video-seo'
import { base64ToBytes } from '../../shared/lib/base64'

describe('parseVideoUrl', () => {
  const YT = 'dQw4w9WgXcQ'
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, YT],
    [`https://youtube.com/watch?feature=share&v=${YT}&t=10`, YT],
    [`https://m.youtube.com/watch?v=${YT}`, YT],
    [`https://youtu.be/${YT}?si=abc`, YT],
    [`https://www.youtube.com/shorts/${YT}`, YT],
    [`https://youtube.com/live/${YT}?feature=share`, YT],
    [`https://www.youtube.com/embed/${YT}`, YT],
    [`https://www.youtube-nocookie.com/embed/${YT}`, YT],
    [`youtube.com/watch?v=${YT}`, YT],
  ])('reads YouTube %s', (url, id) => {
    expect(parseVideoUrl(url)).toEqual({ provider: 'youtube', id })
  })

  it.each([
    ['https://vimeo.com/76979871', { provider: 'vimeo', id: '76979871' }],
    // Unlisted videos only play with their hash.
    ['https://vimeo.com/76979871/8272103f6e', { provider: 'vimeo', id: '76979871', hash: '8272103f6e' }],
    ['https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0', { provider: 'vimeo', id: '76979871', hash: '8272103f6e' }],
    ['https://vimeo.com/channels/staffpicks/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://vimeo.com/showcase/123/video/76979871', { provider: 'vimeo', id: '123' }],
  ])('reads Vimeo %s', (url, ref) => {
    expect(parseVideoUrl(url)).toEqual(ref)
  })

  it('reads every Cloudflare Stream form, including a bare id', () => {
    const id = 'aabbccddee1234567890abcdef123456'
    for (const url of [id, id.toUpperCase(), `https://iframe.videodelivery.net/${id}`, `https://videodelivery.net/${id}/watch`, `https://customer-abc.cloudflarestream.com/${id}/iframe`, `https://watch.cloudflarestream.com/${id}`]) {
      expect(parseVideoUrl(url)).toEqual({ provider: 'stream', id })
    }
  })

  it('returns null for anything else', () => {
    for (const url of ['', '   ', 'https://example.com/video.mp4', 'https://youtube.com/watch?v=short', 'https://vimeo.com/user/abc', 'javascript:alert(1)', 42, null]) {
      expect(parseVideoUrl(url)).toBeNull()
    }
  })
})

describe('video embeds', () => {
  it('uses YouTube\'s no-cookie player and Vimeo\'s do-not-track flag', () => {
    expect(videoEmbedUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ' }, { autoplay: true, muted: true }))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1&mute=1')
    expect(videoEmbedUrl({ provider: 'vimeo', id: '1', hash: 'abcdef12' }))
      .toBe('https://player.vimeo.com/video/1?h=abcdef12&dnt=1')
  })

  it('plays Stream videos by id, or a signed token on the customer subdomain', () => {
    expect(streamEmbedUrl('a'.repeat(32))).toBe(`https://iframe.videodelivery.net/${'a'.repeat(32)}?controls=true`)
    expect(streamEmbedUrl('tok.en.sig', { autoplay: true }, 'abc123')).toBe('https://customer-abc123.cloudflarestream.com/tok.en.sig/iframe?autoplay=true&controls=true')
  })

  it('only trusts Stream player URLs for signed links', () => {
    expect(isStreamPlayerUrl('https://customer-abc123.cloudflarestream.com/a.b.c/iframe?controls=true')).toBe(true)
    expect(isStreamPlayerUrl('https://iframe.videodelivery.net/a.b.c?controls=true')).toBe(true)
    expect(isStreamPlayerUrl('https://evil.example.com/a.b.c/iframe')).toBe(false)
    expect(isStreamPlayerUrl('javascript:alert(1)')).toBe(false)
  })

  it('derives thumbnails where it can', () => {
    expect(videoThumbnailUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(videoThumbnailUrl({ provider: 'vimeo', id: '1' })).toBeNull()
    expect(streamCustomerCode('https://customer-xyz9.cloudflarestream.com/abc/thumbnails/thumbnail.jpg')).toBe('xyz9')
    expect(streamCustomerCode('https://videodelivery.net/abc/thumbnails/thumbnail.jpg')).toBeNull()
  })

  it('finds Video blocks nested in layout slots', () => {
    const content = { type: 'canvas', blocks: [{ id: 'c', type: 'canvas-columns', children: { col1: [{ id: 'v', type: 'canvas-video', props: { url: 'x' } }] } }, { id: 't', type: 'canvas-text' }] }
    expect(findVideoBlocks(content).map(b => b.id)).toEqual(['v'])
    expect(findVideoBlocks(null)).toEqual([])
  })
})

describe('stream helpers', () => {
  it('encodes tus Upload-Metadata', () => {
    expect(tusMetadata({ name: 'Film', maxDurationSeconds: 600, requiresignedurls: true, skipped: undefined }))
      .toBe('name RmlsbQ==,maxDurationSeconds NjAw,requiresignedurls')
  })

  it('signs RS256 playback tokens Stream can verify', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair
    const token = await signStreamToken({ id: 'kid-1', key: pair.privateKey }, 'a'.repeat(32), 3600, Date.UTC(2026, 0, 1))
    const [h, p, sig] = token.split('.')
    const decode = (s: string) => base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/'))
    expect(JSON.parse(new TextDecoder().decode(decode(h!)))).toEqual({ alg: 'RS256', kid: 'kid-1' })
    const iat = Date.UTC(2026, 0, 1) / 1000
    expect(JSON.parse(new TextDecoder().decode(decode(p!)))).toEqual({ sub: 'a'.repeat(32), kid: 'kid-1', exp: iat + 3600, nbf: iat - 60 })
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, decode(sig!), new TextEncoder().encode(`${h}.${p}`))).toBe(true)
  })

  it('formats dates and durations for search engines', () => {
    expect(isoDateTime('2026-01-02 03:04:05')).toBe('2026-01-02T03:04:05.000Z')
    expect(isoDateTime('2026-01-02T03:04:05Z')).toBe('2026-01-02T03:04:05.000Z')
    expect(isoDateTime('nonsense')).toBeNull()
    expect(isoDuration(95)).toBe('PT1M35S')
    expect(isoDuration(3600)).toBe('PT1H')
    expect(isoDuration(3725)).toBe('PT1H2M5S')
    expect(isoDuration(0)).toBeUndefined()
  })
})

describe('VideoObject structured data', () => {
  it('adds one VideoObject per video', () => {
    const graph = buildPageJsonLd({
      title: 'Films',
      url: 'https://acme.test/films',
      videos: [{ name: 'Reel', description: 'Our reel', thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg', embedUrl: 'https://www.youtube-nocookie.com/embed/x', uploadDate: '2026-01-01T00:00:00.000Z', duration: 'PT1M' }],
    }, { name: 'Acme', base: 'https://acme.test' })
    expect(graph.find(g => g['@type'] === 'VideoObject')).toMatchObject({
      name: 'Reel', description: 'Our reel', thumbnailUrl: ['https://i.ytimg.com/vi/x/hqdefault.jpg'],
      uploadDate: '2026-01-01T00:00:00.000Z', duration: 'PT1M', embedUrl: 'https://www.youtube-nocookie.com/embed/x',
    })
  })
})

// A scripted stand-in for XMLHttpRequest: each request takes the next planned outcome.
type Outcome = { status: number; offset?: number } | 'network-error'
function fakeXhr(plan: Outcome[]) {
  const sent: Array<{ method: string; offset: string | null; size: number }> = []
  class FakeXhr {
    upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    status = 0
    statusText = ''
    private method = ''
    private headers: Record<string, string> = {}
    private responseOffset: number | null = null
    open(method: string) { this.method = method }
    setRequestHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v }
    getResponseHeader(k: string) { return k.toLowerCase() === 'upload-offset' && this.responseOffset !== null ? String(this.responseOffset) : null }
    send(body: Blob | null) {
      sent.push({ method: this.method, offset: this.headers['upload-offset'] ?? null, size: body?.size ?? 0 })
      const next = plan.shift() ?? { status: 500 }
      queueMicrotask(() => {
        if (next === 'network-error') return this.onerror?.()
        this.status = next.status
        this.responseOffset = next.offset ?? null
        this.onload?.()
      })
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  return sent
}

describe('resumable upload (tus)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const noWait = () => Promise.resolve()

  it('sends the file in chunks at the offsets Stream confirms', async () => {
    const size = TUS_CHUNK_BYTES * 2 + 10
    const sent = fakeXhr([{ status: 204, offset: TUS_CHUNK_BYTES }, { status: 204, offset: TUS_CHUNK_BYTES * 2 }, { status: 204, offset: size }])
    const progress: number[] = []
    await useVideoUploadXhr().uploadFileViaTus('https://upload.cloudflarestream.com/x', new Blob([new Uint8Array(size)]), p => progress.push(p.percent), noWait)
    expect(sent).toEqual([
      { method: 'PATCH', offset: '0', size: TUS_CHUNK_BYTES },
      { method: 'PATCH', offset: String(TUS_CHUNK_BYTES), size: TUS_CHUNK_BYTES },
      { method: 'PATCH', offset: String(TUS_CHUNK_BYTES * 2), size: 10 },
    ])
    expect(progress.at(-1)).toBe(100)
  })

  it('after a dropped connection, asks Stream how much arrived and carries on from there', async () => {
    const size = TUS_CHUNK_BYTES + 100
    const sent = fakeXhr(['network-error', { status: 200, offset: 5_000_000 }, { status: 204, offset: size }])
    await useVideoUploadXhr().uploadFileViaTus('https://upload.cloudflarestream.com/x', new Blob([new Uint8Array(size)]), undefined, noWait)
    expect(sent.map(s => [s.method, s.offset])).toEqual([['PATCH', '0'], ['HEAD', null], ['PATCH', '5000000']])
    expect(sent[2]!.size).toBe(size - 5_000_000)
  })

  it('gives up on a refusal retrying can\'t fix', async () => {
    fakeXhr([{ status: 404 }])
    await expect(useVideoUploadXhr().uploadFileViaTus('https://upload.cloudflarestream.com/x', new Blob([new Uint8Array(10)]), undefined, noWait))
      .rejects.toMatchObject({ status: 404 })
  })

  it('gives up after repeated network failures', async () => {
    fakeXhr(Array.from({ length: 20 }, () => 'network-error' as const))
    await expect(useVideoUploadXhr().uploadFileViaTus('https://upload.cloudflarestream.com/x', new Blob([new Uint8Array(10)]), undefined, noWait))
      .rejects.toThrow(/Network error/)
  })
})

describe('videos anywhere on a page', () => {
  const STREAM = 'a'.repeat(32)

  it('parses the Video gallery list, keeping only real videos', () => {
    expect(parseVideoList(`https://youtu.be/dQw4w9WgXcQ | Showreel\r\n\nnot a video\nhttps://vimeo.com/1 |  Smith wedding \n${STREAM}`)).toEqual([
      { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Showreel' },
      { url: 'https://vimeo.com/1', title: 'Smith wedding' },
      { url: STREAM, title: '' },
    ])
    expect(parseVideoList(undefined)).toEqual([])
  })

  it('finds Video blocks, gallery entries and post videos, and marks private Stream ones', () => {
    const canvas = {
      type: 'canvas',
      blocks: [
        { id: 'v', type: 'canvas-video', props: { url: STREAM } },
        { id: 'g', type: 'canvas-video-gallery', props: { videos: `${STREAM} | Film\nhttps://youtu.be/dQw4w9WgXcQ` } },
      ],
    }
    const embeds = findVideoEmbeds(canvas)
    expect(embeds.map(e => [e.kind, e.blockId, e.ref.provider])).toEqual([['block', 'v', 'stream'], ['gallery', 'g', 'stream'], ['gallery', 'g', 'youtube']])
    for (const e of embeds) e.mark(true)
    expect(canvas.blocks[0]!.props).toMatchObject({ privateVideo: true })
    expect(canvas.blocks[1]!.props).toMatchObject({ privateVideos: [STREAM] })

    const post = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'video', attrs: { url: STREAM, caption: 'Hi' } }] }
    const [node] = findVideoEmbeds(post)
    expect(node).toMatchObject({ kind: 'node', blockId: null, ref: { provider: 'stream', id: STREAM } })
    node!.mark(false)
    expect(post.content[1]!.attrs).toMatchObject({ privateVideo: false })
  })

  it('makes looping, muted background players', () => {
    expect(videoBackgroundUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ' }))
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&playsinline=1&rel=0&disablekb=1')
    expect(videoBackgroundUrl({ provider: 'vimeo', id: '1', hash: 'abcdef12' })).toBe('https://player.vimeo.com/video/1?h=abcdef12&background=1&dnt=1')
    expect(videoBackgroundUrl({ provider: 'stream', id: STREAM })).toContain('loop=true&controls=false')
  })

  it('renders post videos: a player for YouTube and public Stream, a placeholder otherwise', () => {
    const yt = renderTipTap({ type: 'doc', content: [{ type: 'video', attrs: { url: 'https://youtu.be/dQw4w9WgXcQ', caption: '<b>Our</b> film', aspectRatio: '9:16' } }] })
    expect(yt).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"')
    expect(yt).toContain('padding-bottom:177.78%')
    expect(yt).toContain('<figcaption>&lt;b&gt;Our&lt;/b&gt; film</figcaption>')

    const unknown = renderTipTap({ type: 'doc', content: [{ type: 'video', attrs: { url: STREAM } }] })
    expect(unknown).toContain(`data-nuxflow-video="${STREAM}"`)
    expect(unknown).not.toContain('<iframe')
    const isPublic = renderTipTap({ type: 'doc', content: [{ type: 'video', attrs: { url: STREAM, privateVideo: false } }] })
    expect(isPublic).toContain(`src="https://iframe.videodelivery.net/${STREAM}?controls=true"`)

    expect(renderTipTap({ type: 'doc', content: [{ type: 'video', attrs: { url: 'javascript:alert(1)' } }] })).toBe('')
  })

  it('writes post and gallery videos into Markdown copies as links', () => {
    expect(contentToMarkdown({ type: 'doc', content: [{ type: 'video', attrs: { url: 'https://vimeo.com/1/abcdef12', caption: 'Film' } }] })).toContain('[Film](https://vimeo.com/1/abcdef12)')
    expect(contentToMarkdown({ type: 'canvas', blocks: [{ id: 'g', type: 'canvas-video-gallery', props: { videos: 'https://youtu.be/dQw4w9WgXcQ | Reel' } }] }))
      .toContain('[Reel](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
  })
})
