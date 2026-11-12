// A site's podcast (Settings → Podcast): the show's details, each episode's audio (kept in
// the item's `settings.podcast`), and the rules shared by the feed (/podcast.xml), the
// editor and the site-wide player. Import-free.

export interface PodcastSettings {
  enabled: boolean
  title: string
  description: string
  author: string
  /** Apple asks for an owner email (not shown to listeners in most apps). */
  ownerEmail: string
  /** Square artwork, 1400–3000 px. */
  coverImage: string
  /** One of APPLE_CATEGORIES. */
  category: string
  explicit: boolean
  /** The content type whose items are the episodes (usually `post`). */
  contentType: string
}

export const DEFAULT_PODCAST: PodcastSettings = {
  enabled: false,
  title: '',
  description: '',
  author: '',
  ownerEmail: '',
  coverImage: '',
  category: 'Society & Culture',
  explicit: false,
  contentType: 'post',
}

/** Apple Podcasts' top-level categories (Spotify and others read the same tags). */
export const APPLE_CATEGORIES = [
  'Arts', 'Business', 'Comedy', 'Education', 'Fiction', 'Government', 'Health & Fitness', 'History',
  'Kids & Family', 'Leisure', 'Music', 'News', 'Religion & Spirituality', 'Science', 'Society & Culture',
  'Sports', 'Technology', 'True Crime', 'TV & Film',
]

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** The stored setting, read leniently, field by field. */
export function parsePodcastSettings(value: unknown): PodcastSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    enabled: v.enabled === true,
    title: str(v.title, 200),
    description: str(v.description, 4000),
    author: str(v.author, 200),
    ownerEmail: str(v.ownerEmail, 254),
    coverImage: str(v.coverImage, 2000),
    category: typeof v.category === 'string' && APPLE_CATEGORIES.includes(v.category) ? v.category : DEFAULT_PODCAST.category,
    explicit: v.explicit === true,
    contentType: /^[a-z][a-z0-9-]{0,39}$/.test(String(v.contentType ?? '')) ? String(v.contentType) : 'post',
  }
}

export interface EpisodeInfo {
  audioUrl: string
  /** "45:10" or "1:02:03"; empty when unknown. */
  duration: string
  episode: number | null
  season: number | null
  explicit: boolean
}

/** An item's episode details from its settings, or null when it has no audio. */
export function parseEpisode(settings: unknown): EpisodeInfo | null {
  const p = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).podcast : null
  if (!p || typeof p !== 'object') return null
  const v = p as Record<string, unknown>
  const audioUrl = str(v.audioUrl, 2000)
  if (!audioUrl || !(/^https?:\/\//i.test(audioUrl) || audioUrl.startsWith('/'))) return null
  const num = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x > 0 && x < 100_000 ? x : null)
  return {
    audioUrl,
    duration: durationSeconds(str(v.duration, 12)) !== null ? str(v.duration, 12) : '',
    episode: num(v.episode),
    season: num(v.season),
    explicit: v.explicit === true,
  }
}

/** "45:10" → 2710, "1:02:03" → 3723, "90" → 90; null when it isn't a duration. */
export function durationSeconds(text: string): number | null {
  if (!/^\d{1,3}(?::[0-5]\d){0,2}$/.test(text.trim())) return null
  return text.trim().split(':').map(Number).reduce((total, n) => total * 60 + n, 0)
}

/** What an audio file's extension says it is, for the feed's enclosure. */
export function audioMimeType(url: string): string {
  const ext = url.split('?')[0]!.split('.').pop()?.toLowerCase()
  return ({ mp3: 'audio/mpeg', m4a: 'audio/x-m4a', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' } as Record<string, string>)[ext ?? ''] ?? 'audio/mpeg'
}
