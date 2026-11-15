// Runs only inside the Visual Customizer's preview iframe (a public page of this site).
// 1. Shows the customizer's unpublished choices: the edited CSS, the fonts it needs and
//    the colour scheme. The page's own published customizer theme and appearance styles
//    are switched off while a preview is showing (otherwise a choice set back to its
//    default, which writes no rule, would keep showing the published value). Re-applied
//    after every in-frame navigation, since color-mode resets the scheme then.
// 2. Blocks external link clicks so they don't navigate the iframe away from the
//    site being previewed (same-origin links are still allowed through).
import type { ColorMode } from '#shared/lib/theme-customizer'

interface PreviewMessage {
  css: string
  fontHref: string | null
  colorMode: ColorMode
}

const FONT_URL_RE = /^https:\/\/fonts\.googleapis\.com\/css2\?/

export default defineNuxtPlugin((nuxtApp) => {
  if (window.self === window.top) return

  let last: PreviewMessage | null = null

  function apply(msg: PreviewMessage) {
    const head = document.head

    // The published versions of what the preview replaces.
    head.querySelectorAll<HTMLStyleElement>('style[data-nuxflow-theme="customizer"], style[data-nuxflow-appearance]')
      .forEach((el) => { el.media = 'not all' })

    let style = document.getElementById('nf-customizer-preview') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'nf-customizer-preview'
    }
    style.textContent = msg.css
    head.appendChild(style) // (re)appended so it stays last in the cascade

    let font = document.getElementById('nf-customizer-preview-font') as HTMLLinkElement | null
    if (msg.fontHref && FONT_URL_RE.test(msg.fontHref)) {
      if (!font) {
        font = document.createElement('link')
        font.id = 'nf-customizer-preview-font'
        font.rel = 'stylesheet'
        head.appendChild(font)
      }
      if (font.href !== msg.fontHref) font.href = msg.fontHref
    }
    else {
      font?.remove()
    }

    // The class color-mode would set; set directly so the admin's own saved preference
    // (same origin, same storage) is never touched.
    const dark = msg.colorMode === 'dark'
      || (msg.colorMode === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('light', !dark)
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== 'nuxflow:preview-css') return
    if (window.location.pathname.startsWith('/admin')) return

    const data = event.data as Partial<PreviewMessage>
    last = {
      css: String(data.css ?? ''),
      fontHref: typeof data.fontHref === 'string' ? data.fontHref : null,
      colorMode: data.colorMode === 'light' || data.colorMode === 'dark' ? data.colorMode : 'auto',
    }
    apply(last)
  })

  // color-mode applies the scheme in its own router hook and a watcher; run after both.
  nuxtApp.hook('page:finish', () => {
    if (last) setTimeout(() => last && apply(last), 0)
  })

  // ── External link guard ────────────────────────────────────────────────────
  // Intercept all anchor clicks at the capture phase so Vue Router's own handler
  // still fires for same-origin links (enabling normal preview navigation).
  document.addEventListener('click', (e: MouseEvent) => {
    const anchor = (e.target as Element).closest('a')
    if (!anchor) return

    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#')) return

    try {
      const url = new URL(href, window.location.href)
      if (url.origin !== window.location.origin) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    catch {
      // Malformed URL — block it
      e.preventDefault()
    }
  }, { capture: true })
})
