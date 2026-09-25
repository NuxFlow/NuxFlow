/**
 * Path prefix for R2 objects served through this Worker (server/routes/_nuxflow/media/),
 * used when a site has the MEDIA_BUCKET binding but no public R2 URL configured. Lives
 * under `/_nuxflow/` with the other system routes so it can never shadow a CMS page
 * slug, and so the full-page cache (which skips `/_*`) never touches it.
 */
export const WORKER_MEDIA_PREFIX = '/_nuxflow/media/'

/**
 * Worker-served media URLs are stored site-relative (`/_nuxflow/media/<key>`) so they
 * keep working through a domain change and on every domain of a multi-site install.
 * Anything that leaves the site — RSS/Atom, sitemaps, og:image, JSON-LD — needs an
 * absolute URL instead; this prefixes `base` onto a site-relative path and leaves
 * absolute URLs (and data: URIs) untouched.
 */
export function absoluteUrl(url: string, base: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url
  return `${base.replace(/\/+$/, '')}${url}`
}

/**
 * Rewrites site-relative `src="/…"` / `href="/…"` attributes inside an HTML fragment to
 * absolute ones — for feed `<content:encoded>` bodies, where most readers don't resolve
 * relative URLs against the item link.
 */
export function absolutizeHtmlUrls(html: string, base: string): string {
  const root = base.replace(/\/+$/, '')
  return html.replace(/\b(src|href)="\/(?!\/)/g, (_m, attr: string) => `${attr}="${root}/`)
}
