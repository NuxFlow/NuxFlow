import type { H3Event } from 'h3'
import { useReplicaDb } from '../utils/db'
import { sites } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { withEdgeCache } from '../utils/edge-cache'
import { escapeMarkdown } from '../utils/markdown'
import { getSeoSettings, siteBaseUrl } from '../utils/seo'
import { getIndexableEntries, type IndexableEntry } from '../utils/sitemap-entries'

// Newest items listed per content type. llms.txt is meant to be a concise map for an
// LLM's context window, not a full index — the sitemap and llms-full.txt cover the rest.
const PER_SECTION_LIMIT = 100

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const db = useReplicaDb(event)
  const seo = await getSeoSettings(db, siteId)
  // Off when the site opts out, or when it blocks every AI crawler — offering an
  // AI-specific index while telling AI crawlers to stay away would be contradictory.
  if (!seo.llmsEnabled || seo.aiCrawlers === 'disallow') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  setHeader(event, 'Content-Type', 'text/plain; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return withEdgeCache(event, 3600, () => buildLlmsTxt(event))
})

/** One `- [Title](url): description` line, Markdown-escaped. */
function llmsLink(entry: Pick<IndexableEntry, 'title' | 'description'>, url: string): string {
  const desc = entry.description ? `: ${escapeMarkdown(entry.description.replace(/\s+/g, ' ').trim().slice(0, 160))}` : ''
  return `- [${escapeMarkdown(entry.title)}](${url})${desc}`
}

async function buildLlmsTxt(event: H3Event) {
  const db = useReplicaDb(event)
  const siteId = event.context.siteId as string

  const [site, seo] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true } }),
    getSeoSettings(db, siteId),
  ])
  const baseUrl = siteBaseUrl(seo, site?.domain, useRuntimeConfig().public.siteUrl as string)
  const siteName = site?.name ?? 'NuxFlow'
  const siteDesc = seo.description || `Content published by ${siteName}`

  const { entries } = await getIndexableEntries(db, siteId, seo, 5000)
  // Link the Markdown alternate when it's on — that's the form an LLM actually wants.
  const urlFor = (path: string) => seo.markdownEnabled
    ? `${baseUrl}${path === '/' ? '/index' : path}.md`
    : `${baseUrl}${path}`

  // One section per content type, in the order types first appear (newest content first),
  // with the homepage pulled to the top.
  const sections = new Map<string, IndexableEntry[]>()
  for (const e of entries) {
    if (e.path === '/') continue
    const key = e.typeName || 'Pages'
    sections.set(key, [...(sections.get(key) ?? []), e])
  }

  const parts: string[] = [`# ${siteName}`, '', `> ${siteDesc.replace(/\s+/g, ' ')}`]
  if (seo.llmsIntro) parts.push('', seo.llmsIntro)

  const home = entries.find(e => e.path === '/')
  if (home) parts.push('', llmsLink({ title: `${siteName} — home`, description: home.description }, urlFor('/')))

  for (const [name, list] of sections) {
    parts.push('', `## ${escapeMarkdown(name)}`, '')
    for (const e of list.slice(0, PER_SECTION_LIMIT)) parts.push(llmsLink(e, urlFor(e.path)))
    if (list.length > PER_SECTION_LIMIT) parts.push(`- …and ${list.length - PER_SECTION_LIMIT} more — see the [sitemap](${baseUrl}/sitemap.xml)`)
  }
  if (sections.size === 0 && !home) parts.push('', '_No published content yet._')

  parts.push(
    '',
    '## Optional',
    '',
    `- [Full content](${baseUrl}/llms-full.txt): Every page's full text as Markdown in one file`,
    `- [Sitemap](${baseUrl}/sitemap.xml): Complete list of URLs`,
    `- [RSS feed](${baseUrl}/feed.xml): Latest posts (RSS 2.0)`,
    `- [Atom feed](${baseUrl}/atom.xml): Latest posts (Atom 1.0)`,
    '',
  )
  if (seo.markdownEnabled) {
    parts.push('Any page is also available as Markdown by appending `.md` to its URL, or by requesting it with `Accept: text/markdown`.', '')
  }
  return parts.join('\n')
}
