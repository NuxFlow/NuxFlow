import type { H3Event } from 'h3'
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { contentItems, products } from '@nuxflow/db/schema'
import { addDays, eventHasEnded, formatEventWhen, todayIn } from '@nuxflow/canvas/events'
import type { Db } from './db'
import { getContentTypeBySlug } from './content-queries'
import { eventTimeframe, expandSeries } from './event-feed'
import { getShopSettings } from './shop'
import { liveStock, loadProduct, toPublicProduct } from './products'
import { APPOINTMENT_BLOCK, listFreeTimes, type ServiceContext } from './appointments'
import { parseService } from '../../shared/lib/appointments'
import type { ChatbotSettings } from '../../shared/lib/chatbot'

/**
 * Details the chatbot reads at the moment it answers, so it never quotes a stale price,
 * stock level, date or free time from the index: the next few events always, and — for the
 * pages it found for this question — their product's price and stock, and the next free
 * times of any appointment service on them. Each part is best-effort: a failure leaves it
 * out rather than failing the answer. Admins can switch each off (`settings.live`).
 */

/** Events listed, at most. */
const EVENTS = 8
/** How far ahead repeating events' dates are looked for. */
const SERIES_DAYS = 60
/** Free days and times per service. */
const FREE_DAYS = 3
const FREE_TIMES_PER_DAY = 4

export interface LivePassageSource { kind: 'content' | 'knowledge'; id: string; path: string | null; title: string }

export interface LiveSite { timezone: string; locale: string }

export async function chatLiveFacts(event: H3Event, db: Db, siteId: string, site: LiveSite, settings: ChatbotSettings, sources: LivePassageSource[], now = new Date()): Promise<string> {
  const pages = sources.filter(s => s.kind === 'content')
  const parts = await Promise.all([
    settings.live.events ? safely('events', () => upcomingEvents(db, siteId, site, now)) : '',
    settings.live.products && pages.length ? safely('products', () => productFacts(event, db, siteId, site, pages)) : '',
    settings.live.appointments && pages.length ? safely('appointments', () => appointmentFacts(event, db, siteId, site, pages)) : '',
  ])
  return parts.filter(Boolean).join('\n\n')
}

async function safely(what: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn()
  }
  catch (err) {
    console.error(`[chatbot] Live ${what} left out:`, err)
    return ''
  }
}

/** The next few public events, one line each. */
export async function upcomingEvents(db: Db, siteId: string, site: LiveSite, now = new Date()): Promise<string> {
  const type = await getContentTypeBySlug(db, siteId, 'event', { id: true })
  if (!type) return ''
  const timeZone = site.timezone || 'UTC'
  const columns = { id: true, slug: true, title: true, eventStartAt: true, eventEndAt: true, eventAllDay: true, eventLocation: true, eventRecurrence: true, eventPrice: true, eventCurrency: true, eventRsvpEnabled: true } as const
  const base = [
    eq(contentItems.siteId, siteId),
    eq(contentItems.typeId, type.id),
    eq(contentItems.status, 'published'),
    eq(contentItems.visibility, 'public'),
    isNull(contentItems.sourceItemId),
  ]
  const [oneOffs, series] = await Promise.all([
    db.query.contentItems.findMany({
      where: and(...base, isNull(contentItems.eventRecurrence), eventTimeframe('upcoming', now, timeZone)),
      orderBy: [asc(contentItems.eventStartAt)],
      limit: EVENTS,
      columns,
    }),
    db.query.contentItems.findMany({ where: and(...base, isNotNull(contentItems.eventRecurrence)), limit: 30, columns }),
  ])
  const today = todayIn(timeZone, now)
  const dates = series.flatMap(row => expandSeries(row, timeZone, addDays(today, -1), addDays(today, SERIES_DAYS), EVENTS))
    .filter(row => !eventHasEnded({ eventStartAt: row.eventStartAt, eventEndAt: row.eventEndAt, eventAllDay: row.eventAllDay }, timeZone, now))
  const all = [...oneOffs, ...dates]
    .filter(r => r.eventStartAt)
    .sort((a, b) => (a.eventStartAt ?? '').localeCompare(b.eventStartAt ?? ''))
    .slice(0, EVENTS)
  if (!all.length) return ''
  const lines = all.map((r) => {
    const when = formatEventWhen({ eventStartAt: r.eventStartAt ?? '', eventEndAt: r.eventEndAt, eventAllDay: r.eventAllDay }, timeZone, 'en-GB')
    const bits = [`${r.title} — ${when}`]
    if (r.eventLocation) bits.push(`at ${r.eventLocation}`)
    if (r.eventPrice) bits.push(`${r.eventPrice} ${(r.eventCurrency ?? '').toUpperCase()}`.trim())
    if (r.eventRsvpEnabled) bits.push('book on its page')
    return `- ${bits.join(', ')} (page /${r.slug})`
  })
  return `UPCOMING EVENTS (soonest first)\n${lines.join('\n')}`
}

/** Price and live stock for the products among the pages found. */
async function productFacts(event: H3Event, db: Db, siteId: string, site: LiveSite, pages: LivePassageSource[]): Promise<string> {
  const ids = [...new Set(pages.map(p => p.id))]
  const rows = await db.select({ id: products.contentItemId }).from(products)
    .where(and(eq(products.siteId, siteId), inArray(products.contentItemId, ids)))
  if (!rows.length) return ''
  const shop = await getShopSettings(event)
  if (!shop.enabled) return ''
  const lines: string[] = []
  for (const { id } of rows.slice(0, 4)) {
    const page = pages.find(p => p.id === id)!
    const [loaded, stock] = await Promise.all([loadProduct(db, siteId, id), liveStock(db, siteId, id)])
    const product = toPublicProduct(id, loaded, shop, site.locale)
    if (!product) continue
    const stockBy = new Map(stock.map(s => [s.id, s]))
    const variants = product.variants.map((v) => {
      const s = stockBy.get(v.id)
      const state = !v.available ? 'sold out' : s?.message || 'in stock'
      return `${v.label || 'Standard'}: ${v.price}, ${state}`
    })
    lines.push(`- ${page.title} (page ${page.path ?? ''}): ${variants.length ? variants.join('; ') : product.priceLabel}${product.available ? '' : ' — currently sold out'}`)
  }
  return lines.length ? `PRODUCTS (live price and stock)\n${lines.join('\n')}` : ''
}

interface BlockLike { id?: string; type?: string; props?: Record<string, unknown>; children?: Record<string, unknown> }

function appointmentBlocks(content: unknown): BlockLike[] {
  const out: BlockLike[] = []
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return
    for (const b of list as BlockLike[]) {
      if (!b || typeof b !== 'object') continue
      if (b.type === APPOINTMENT_BLOCK && b.id) out.push(b)
      for (const kids of Object.values(b.children ?? {})) walk(kids)
    }
  }
  walk((content as { blocks?: unknown } | null)?.blocks)
  return out
}

/** The next free times of each appointment service on the pages found. */
async function appointmentFacts(event: H3Event, db: Db, siteId: string, site: LiveSite, pages: LivePassageSource[]): Promise<string> {
  const ids = [...new Set(pages.map(p => p.id))].slice(0, 4)
  const rows = await db.select({ id: contentItems.id, slug: contentItems.slug, title: contentItems.title, sourceItemId: contentItems.sourceItemId, content: contentItems.content })
    .from(contentItems)
    .where(and(eq(contentItems.siteId, siteId), inArray(contentItems.id, ids), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')))
  const lines: string[] = []
  for (const row of rows) {
    for (const block of appointmentBlocks(row.content).slice(0, 2)) {
      const ctx: ServiceContext = {
        siteId,
        page: { id: row.id, slug: row.slug, title: row.title, sourceItemId: row.sourceItemId },
        blockId: block.id!,
        service: parseService(block.props, row.title),
        timeZone: site.timezone || 'UTC',
        locale: site.locale || 'en',
      }
      const free = await listFreeTimes(event, ctx)
      const days = free.days.filter(d => d.times.length).slice(0, FREE_DAYS)
      const path = pages.find(p => p.id === row.id)?.path ?? `/${row.slug}`
      const price = free.service.price ? `${free.service.price} ${free.service.currency}` : 'free'
      lines.push(days.length
        ? `- ${free.service.name} (${free.service.durationText}, ${price}; book on page ${path}): next free ${days.map(d => `${d.date} at ${d.times.slice(0, FREE_TIMES_PER_DAY).map(t => t.time).join(', ')}`).join('; ')}`
        : `- ${free.service.name} (book on page ${path}): no free times in the next ${free.days.length} days`)
    }
  }
  return lines.length ? `APPOINTMENTS (free times right now, ${site.timezone || 'UTC'})\n${lines.join('\n')}` : ''
}
