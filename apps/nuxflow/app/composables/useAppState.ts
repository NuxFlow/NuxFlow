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

export interface ActiveLocale {
  locale: string
  slug: string
  rawSlug?: string
}

/** The current page's translations, set by the page and read by the header's language switcher. */
export function useActiveLocales() {
  return useState<ActiveLocale[]>('active-locales', () => [])
}
