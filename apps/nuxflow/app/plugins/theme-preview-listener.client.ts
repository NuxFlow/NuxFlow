// Runs only inside the customizer iframe (when the page is embedded as a preview).
// 1. Listens for CSS from the parent customizer panel and injects it as a live
//    <style> element so changes appear instantly without a page reload.
// 2. Blocks external link clicks so they don't navigate the iframe away from the
//    site being previewed (same-origin links are still allowed through).
export default defineNuxtPlugin(() => {
  if (window.self === window.top) return

  // ── CSS injection ──────────────────────────────────────────────────────────
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== 'nuxflow:preview-css') return
    if (window.location.pathname.startsWith('/admin')) return

    let style = document.getElementById('nf-customizer-preview') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'nf-customizer-preview'
      document.head.appendChild(style)
    }
    style.textContent = String(event.data.css ?? '')
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
    } catch {
      // Malformed URL — block it
      e.preventDefault()
    }
  }, { capture: true })
})
