// Shared `useState` slots, each defined once so every reader and writer agrees on its key,
// type and default. (The signed-in user's slot is useSessionUserState() in useAuth.ts.)

/** Whether this site still needs the setup wizard. Null until 00.setup-guard.global.ts has asked. */
export function useNeedsSetup() {
  return useState<boolean | null>('setup:needs-setup', () => null)
}

/**
 * A public path the page-view beacon must skip (an error page rendered by PublicContentPage),
 * read by app/plugins/page-views.client.ts.
 */
export function useUncountedViewPath() {
  return useState<string | null>('nuxflow:uncounted-view-path', () => null)
}

/**
 * The content type open in the admin editor (null elsewhere), set by the editor page and read
 * by the sidebar so that editing a post lights Posts: an item's URL doesn't name its type.
 */
export function useEditingContentType() {
  return useState<string | null>('admin:editing-content-type', () => null)
}

export interface ActiveLocale {
  locale: string
  slug: string
  rawSlug?: string
}

/** The current page's translations, set by the page and read by the header's language switcher. */
export function useActiveLocales() {
  return useState<ActiveLocale[]>('active-locales', () => [])
}

export interface AudioTrack {
  src: string
  title: string
  /** The page it's from, linked from the player. */
  link?: string
  /** "45:10", shown before the audio has loaded. */
  duration?: string
}

/**
 * What the site-wide audio player (PublicAudioPlayer, in the default layout) is playing. The
 * layout stays mounted as visitors move between pages, so the audio keeps going.
 */
export function useAudioTrack() {
  return useState<AudioTrack | null>('nuxflow:audio-track', () => null)
}
