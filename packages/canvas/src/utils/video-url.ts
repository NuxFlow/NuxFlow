// The one parser for the Video block's URL field, shared by the block itself and the
// server (structured data, the video sitemap, private-video playback), so every place
// agrees on which video a block shows. Plain functions, no Vue or Nuxt imports — the
// server reaches it as `@nuxflow/canvas/video`.

export type VideoProvider = 'youtube' | 'vimeo' | 'stream'

export interface VideoRef {
  provider: VideoProvider
  id: string
  /** Vimeo's privacy hash for unlisted videos (`vimeo.com/123/abc123` or `?h=abc123`). */
  hash?: string
}

const STREAM_ID_RE = /^[a-f0-9]{32}$/i
const YOUTUBE_ID_RE = /^[\w-]{11}$/
const VIMEO_ID_RE = /^\d{1,12}$/
const VIMEO_HASH_RE = /^[a-f0-9]{6,32}$/i

const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com', 'music.youtube.com'])
// Path prefixes that put the video id in the next segment: /embed/ID, /shorts/ID, /live/ID…
const YOUTUBE_ID_PATHS = new Set(['embed', 'shorts', 'live', 'v', 'e'])

function toUrl(raw: string): URL | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : raw.startsWith('//') ? `https:${raw}` : `https://${raw}`
  try {
    return new URL(withScheme)
  } catch {
    return null
  }
}

/**
 * The video a URL points at — YouTube (watch, youtu.be, Shorts, live, embed), Vimeo
 * (including unlisted links, whose hash is required to play them) or Cloudflare Stream
 * (any of its URL forms, or a bare 32-character video id). Null for anything else.
 */
export function parseVideoUrl(raw: unknown): VideoRef | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  if (STREAM_ID_RE.test(value)) return { provider: 'stream', id: value.toLowerCase() }

  const url = toUrl(value)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' || YOUTUBE_HOSTS.has(host)) {
    let id: string | null | undefined
    if (host === 'youtu.be') id = parts[0]
    else if (parts[0] === 'watch') id = url.searchParams.get('v')
    else if (parts[0] && YOUTUBE_ID_PATHS.has(parts[0])) id = parts[1]
    return id && YOUTUBE_ID_RE.test(id) ? { provider: 'youtube', id } : null
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), vimeo.com/channels/x/123,
    // vimeo.com/showcase/x/video/123, player.vimeo.com/video/123?h=abcdef
    const at = parts.findIndex(p => VIMEO_ID_RE.test(p))
    if (at === -1) return null
    const next = parts[at + 1]
    const hash = url.searchParams.get('h') ?? (next && VIMEO_HASH_RE.test(next) ? next : undefined)
    return { provider: 'vimeo', id: parts[at]!, ...(hash && VIMEO_HASH_RE.test(hash) ? { hash } : {}) }
  }

  if (host === 'videodelivery.net' || host === 'iframe.videodelivery.net' || host === 'cloudflarestream.com' || host.endsWith('.cloudflarestream.com')) {
    const id = parts.find(p => STREAM_ID_RE.test(p))
    return id ? { provider: 'stream', id: id.toLowerCase() } : null
  }

  return null
}

export interface VideoEmbedOptions {
  autoplay?: boolean
  muted?: boolean
}

/**
 * The player URL to put in the block's iframe. YouTube uses its privacy-enhanced
 * (no-cookie) domain and Vimeo `dnt=1`, so neither sets tracking cookies before a visitor
 * has pressed play — the site's cookie banner doesn't cover third-party players.
 */
export function videoEmbedUrl(ref: VideoRef, opts: VideoEmbedOptions = {}): string {
  const params = new URLSearchParams()
  switch (ref.provider) {
    case 'youtube':
      params.set('rel', '0')
      if (opts.autoplay) params.set('autoplay', '1')
      if (opts.muted) params.set('mute', '1')
      return `https://www.youtube-nocookie.com/embed/${ref.id}?${params}`
    case 'vimeo':
      if (ref.hash) params.set('h', ref.hash)
      params.set('dnt', '1')
      if (opts.autoplay) params.set('autoplay', '1')
      if (opts.muted) params.set('muted', '1')
      return `https://player.vimeo.com/video/${ref.id}?${params}`
    case 'stream':
      return streamEmbedUrl(ref.id, opts)
  }
}

/**
 * Cloudflare Stream's player for a video id — or for a signed token in its place, which is
 * how a private video (requireSignedURLs) is played.
 */
export function streamEmbedUrl(idOrToken: string, opts: VideoEmbedOptions = {}, customerCode?: string | null): string {
  const params = new URLSearchParams()
  if (opts.autoplay) params.set('autoplay', 'true')
  if (opts.muted) params.set('muted', 'true')
  params.set('controls', 'true')
  return customerCode
    ? `https://customer-${customerCode}.cloudflarestream.com/${idOrToken}/iframe?${params}`
    : `https://iframe.videodelivery.net/${idOrToken}?${params}`
}

/** A still image for the video, where one can be derived from the id alone (not Vimeo). */
export function videoThumbnailUrl(ref: VideoRef): string | null {
  switch (ref.provider) {
    case 'youtube': return `https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg`
    case 'stream': return `https://videodelivery.net/${ref.id}/thumbnails/thumbnail.jpg`
    default: return null
  }
}

/** The video's own page on its platform (Markdown copies, llms.txt). */
export function videoWatchUrl(ref: VideoRef): string {
  switch (ref.provider) {
    case 'youtube': return `https://www.youtube.com/watch?v=${ref.id}`
    case 'vimeo': return ref.hash ? `https://vimeo.com/${ref.id}/${ref.hash}` : `https://vimeo.com/${ref.id}`
    case 'stream': return `https://iframe.videodelivery.net/${ref.id}`
  }
}

/** Is a URL one of Cloudflare Stream's signed-player addresses the server hands out? */
export function isStreamPlayerUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  return /^https:\/\/(?:iframe\.videodelivery\.net|customer-[a-z0-9]+\.cloudflarestream\.com)\/[\w.-]+(?:\/iframe)?(?:\?[\w=&%.-]*)?$/i.test(url)
}

/**
 * A looping, muted, control-less player for a background (the Hero block). Null for a
 * Stream id given as a signed token — backgrounds play public videos only.
 */
export function videoBackgroundUrl(ref: VideoRef): string {
  const params = new URLSearchParams()
  switch (ref.provider) {
    case 'youtube':
      // `playlist` = the same id is what makes a single YouTube video loop.
      for (const [k, v] of [['autoplay', '1'], ['mute', '1'], ['loop', '1'], ['playlist', ref.id], ['controls', '0'], ['playsinline', '1'], ['rel', '0'], ['disablekb', '1']]) params.set(k!, v!)
      return `https://www.youtube-nocookie.com/embed/${ref.id}?${params}`
    case 'vimeo':
      if (ref.hash) params.set('h', ref.hash)
      // Vimeo's background mode: autoplay, muted, looped, no controls.
      params.set('background', '1')
      params.set('dnt', '1')
      return `https://player.vimeo.com/video/${ref.id}?${params}`
    case 'stream':
      for (const [k, v] of [['autoplay', 'true'], ['muted', 'true'], ['loop', 'true'], ['controls', 'false'], ['preload', 'auto']]) params.set(k!, v!)
      return `https://iframe.videodelivery.net/${ref.id}?${params}`
  }
}

export interface VideoListItem {
  url: string
  title: string
}

/**
 * The Video gallery block's list: one video per line, as `URL` or `URL | Title`. Lines
 * that aren't a recognised video are dropped.
 */
export function parseVideoList(text: unknown): VideoListItem[] {
  if (typeof text !== 'string') return []
  const out: VideoListItem[] = []
  for (const line of text.split(/\r?\n/)) {
    const bar = line.indexOf('|')
    const url = (bar === -1 ? line : line.slice(0, bar)).trim()
    const title = bar === -1 ? '' : line.slice(bar + 1).trim()
    if (url && parseVideoUrl(url)) out.push({ url, title })
    if (out.length >= 100) break
  }
  return out
}

interface CanvasBlockLike { id?: unknown; type?: unknown; props?: Record<string, unknown>; children?: Record<string, unknown> }

/** Every Video block in a Canvas document, including those inside Columns/Container slots, in page order. */
export function findVideoBlocks(content: unknown): CanvasBlockLike[] {
  const out: CanvasBlockLike[] = []
  walkCanvas(content, (b) => {
    if (b.type === 'canvas-video') out.push(b)
  })
  return out
}

function walkCanvas(content: unknown, visit: (b: CanvasBlockLike) => void) {
  const walk = (list: unknown, depth: number) => {
    if (!Array.isArray(list) || depth > 20) return
    for (const b of list as CanvasBlockLike[]) {
      if (!b || typeof b !== 'object') continue
      visit(b)
      for (const kids of Object.values(b.children ?? {})) walk(kids, depth + 1)
    }
  }
  walk((content as { blocks?: unknown } | null)?.blocks, 0)
}

/**
 * One video shown on a page, wherever it sits: a Canvas Video block (`block`), one entry of
 * a Video gallery block (`gallery`), or a video in a post's prose (`node`, TipTap). `props`
 * carries the url plus the optional caption/title/description; `mark(isPrivate)` records,
 * on the content it came from, whether a Stream video is private — the public page API
 * does that on a copy, so the browser knows to fetch a signed link.
 */
export interface VideoEmbed {
  kind: 'block' | 'gallery' | 'node'
  /** The Canvas block id (block and gallery); null for prose. */
  blockId: string | null
  ref: VideoRef
  props: Record<string, unknown>
  mark(isPrivate: boolean): void
}

interface TipTapLike { type?: unknown; attrs?: Record<string, unknown>; content?: unknown }

/** Every video on a page (Canvas or TipTap content), in page order. */
export function findVideoEmbeds(content: unknown): VideoEmbed[] {
  const out: VideoEmbed[] = []
  if ((content as { type?: unknown } | null)?.type === 'canvas') {
    walkCanvas(content, (b) => {
      const props = b.props ?? {}
      const blockId = typeof b.id === 'string' ? b.id : null
      if (b.type === 'canvas-video') {
        const ref = parseVideoUrl(props.url)
        if (ref) out.push({ kind: 'block', blockId, ref, props, mark: (p) => { props.privateVideo = p } })
      } else if (b.type === 'canvas-video-gallery') {
        for (const item of parseVideoList(props.videos)) {
          const ref = parseVideoUrl(item.url)!
          out.push({
            kind: 'gallery',
            blockId,
            ref,
            props: { url: item.url, title: item.title },
            mark: (p) => {
              if (ref.provider !== 'stream') return
              const list = Array.isArray(props.privateVideos) ? props.privateVideos as string[] : []
              props.privateVideos = p ? [...new Set([...list, ref.id])] : list.filter(id => id !== ref.id)
            },
          })
        }
      }
    })
    return out
  }
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 60) return
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1)
      return
    }
    const n = node as TipTapLike
    if (n.type === 'video' && n.attrs) {
      const attrs = n.attrs
      const ref = parseVideoUrl(attrs.url)
      if (ref) out.push({ kind: 'node', blockId: null, ref, props: attrs, mark: (p) => { attrs.privateVideo = p } })
    }
    walk(n.content, depth + 1)
  }
  walk(content, 0)
  return out
}
