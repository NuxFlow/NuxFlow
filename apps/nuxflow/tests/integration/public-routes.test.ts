/**
 * Integration tests for the anonymous public API routes and feeds that previously
 * had no coverage:
 *   GET /api/public/events, /events.ics, /api/public/forms/:id, /api/public/memberships,
 *   /api/public/menus/:location, /api/public/taxonomy/:taxonomy/:term,
 *   /api/public/auth/registration-status, /api/public/dynamic-plugins, /sitemap-images.xml
 *
 * The recurring invariant: nothing private, members-only, unpublished, inactive, or
 * belonging to another site is ever returned from an unauthenticated, edge-cached route.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedContentType, seedContentItem, seedTier, seedSetting, seedMedia } from '../helpers/seed'
import { forms, menus, taxonomies, taxonomyTerms, contentTaxonomyTerms, dynamicPlugins } from '@nuxflow/db/schema'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: eventsHandler } = await import('../../server/api/public/events.get')
const { default: icsHandler } = await import('../../server/routes/events.ics')
const { default: formHandler } = await import('../../server/api/public/forms/[formIdentifier].get')
const { default: membershipsHandler } = await import('../../server/api/public/memberships.get')
const { default: menuHandler } = await import('../../server/api/public/menus/[location].get')
const { default: taxonomyHandler } = await import('../../server/api/public/taxonomy/[taxonomySlug]/[termSlug].get')
const { default: registrationStatusHandler } = await import('../../server/api/public/auth/registration-status.get')
const { default: pluginsHandler } = await import('../../server/api/public/dynamic-plugins.get')
const { default: imageSitemapHandler } = await import('../../server/routes/sitemap-images.xml')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-public-routes-01'
const OTHER = 'site-public-routes-02'
const EMPTY = 'site-public-routes-03'

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'pub.localhost', name: 'Pub, Site; Test' })
  await seedSite(db, { id: OTHER, domain: 'pub2.localhost' })
  await seedSite(db, { id: EMPTY, domain: 'pub3.localhost' })

  const eventType = await seedContentType(db, SITE, { slug: 'event', name: 'Event' })
  const foreignEventType = await seedContentType(db, OTHER, { slug: 'event', name: 'Event' })

  const secretBody = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MEMBERS-ONLY-BODY' }] }] }
  await seedContentItem(db, SITE, eventType, { slug: 'far', title: 'Far event', eventStartAt: inDays(30), content: secretBody })
  await seedContentItem(db, SITE, eventType, { slug: 'soon', title: 'Soon event', eventStartAt: inDays(1), excerpt: 'Line 1\nLine, 2; ok', eventLocation: 'Room A, Floor 2' })
  await seedContentItem(db, SITE, eventType, { slug: 'mid', title: 'Mid event', eventStartAt: '2099-01-01T00:00:00.000Z', eventAllDay: true })
  await seedContentItem(db, SITE, eventType, { slug: 'private-ev', title: 'Private event', eventStartAt: inDays(2), visibility: 'private' })
  await seedContentItem(db, SITE, eventType, { slug: 'members-ev', title: 'Members event', eventStartAt: inDays(3), visibility: 'members', content: secretBody })
  await seedContentItem(db, SITE, eventType, { slug: 'draft-ev', title: 'Draft event', eventStartAt: inDays(4), status: 'draft' })
  await seedContentItem(db, SITE, eventType, { slug: 'past-ev', title: 'Past event', eventStartAt: inDays(-5) })
  await seedContentItem(db, OTHER, foreignEventType, { slug: 'foreign-ev', title: 'Foreign event', eventStartAt: inDays(1) })
})

afterAll(teardownTestDb)

function ev(opts: { siteId?: string; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  return createMockEvent({ siteId: opts.siteId ?? SITE, params: opts.params, query: opts.query }) as unknown as H3Event
}

describe('GET /api/public/events', () => {
  it('returns only public, published, upcoming events for this site, soonest first', async () => {
    const res = await (eventsHandler as Handler)(ev()) as { events: { title: string }[] }
    expect(res.events.map(e => e.title)).toEqual(['Soon event', 'Far event', 'Mid event'])
  })

  it('never includes the event body or other internal columns', async () => {
    const res = await (eventsHandler as Handler)(ev())
    const json = JSON.stringify(res)
    expect(json).not.toContain('MEMBERS-ONLY-BODY')
    const first = (res as { events: Record<string, unknown>[] }).events[0]
    expect(Object.keys(first).sort()).toEqual(
      ['eventAllDay', 'eventEndAt', 'eventLocation', 'eventStartAt', 'eventUrl', 'excerpt', 'id', 'slug', 'title'],
    )
  })

  it('keeps the soonest events when the limit truncates the list', async () => {
    const res = await (eventsHandler as Handler)(ev({ query: { limit: '1' } })) as { events: { title: string }[] }
    expect(res.events.map(e => e.title)).toEqual(['Soon event'])
  })

  it('applies from/to bounds', async () => {
    const res = await (eventsHandler as Handler)(ev({ query: { from: inDays(-10), to: inDays(10) } })) as { events: { title: string }[] }
    expect(res.events.map(e => e.title)).toEqual(['Past event', 'Soon event'])
  })

  it('tolerates junk limit/offset values instead of passing NaN to SQL', async () => {
    const res = await (eventsHandler as Handler)(ev({ query: { limit: 'abc', offset: '-5' } })) as { events: unknown[] }
    expect(res.events).toHaveLength(3)
  })

  it('returns an empty list when the site has no event type', async () => {
    expect(await (eventsHandler as Handler)(ev({ siteId: EMPTY }))).toEqual({ events: [] })
  })
})

describe('GET /events.ics', () => {
  it('emits a valid calendar with only public, published events and escaped text', async () => {
    const event = ev()
    const ics = await (icsHandler as Handler)(event) as string
    expect((event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['Content-Type']).toContain('text/calendar')

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('SUMMARY:Soon event')
    expect(ics).toContain('SUMMARY:Past event') // 90-day look-back window
    expect(ics).not.toContain('Private event')
    expect(ics).not.toContain('Members event')
    expect(ics).not.toContain('Draft event')
    expect(ics).not.toContain('Foreign event')

    // RFC 5545 TEXT escaping
    expect(ics).toContain('X-WR-CALNAME:Pub, Site; Test Events')
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine\\, 2\\; ok')
    expect(ics).toContain('LOCATION:Room A\\, Floor 2')
  })

  it('uses DATE values with an exclusive next-day end for all-day events', async () => {
    const ics = await (icsHandler as Handler)(ev()) as string
    expect(ics).toContain('DTSTART;VALUE=DATE:20990101')
    expect(ics).toContain('DTEND;VALUE=DATE:20990102')
  })

  it('returns an empty calendar when the site has no event type', async () => {
    const ics = await (icsHandler as Handler)(ev({ siteId: EMPTY })) as string
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })
})

describe('GET /api/public/forms/:formIdentifier', () => {
  beforeAll(async () => {
    const db = getCurrentTestDb()
    await db.insert(forms).values([
      {
        id: ulid(), siteId: SITE, name: 'Contact', slug: 'contact', status: 'active',
        notifications: { email: 'owner@private.test' },
        fields: [
          { id: 'f1', type: 'text', label: 'Name', name: 'name', required: true, internalNote: 'secret' } as never,
          { id: 'f2', type: 'computed', label: 'Total', name: 'total', formula: 'a+b' } as never,
        ],
      },
      { id: ulid(), siteId: SITE, name: 'Old', slug: 'old', status: 'closed', fields: [] },
      { id: ulid(), siteId: OTHER, name: 'Foreign', slug: 'foreign', status: 'active', fields: [] },
    ])
  })

  it('returns only whitelisted field properties and no notification settings', async () => {
    const res = await (formHandler as Handler)(ev({ params: { formIdentifier: 'contact' } })) as { name: string; fields: Record<string, unknown>[] }
    expect(res.name).toBe('Contact')
    expect(JSON.stringify(res)).not.toContain('owner@private.test')
    expect(JSON.stringify(res)).not.toContain('internalNote')
    expect(res.fields[0].formula).toBeUndefined()
    expect(res.fields[1].formula).toBe('a+b')
  })

  it('404s for a closed form and for another site\'s form', async () => {
    await expect((formHandler as Handler)(ev({ params: { formIdentifier: 'old' } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((formHandler as Handler)(ev({ params: { formIdentifier: 'foreign' } }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/public/memberships', () => {
  it('lists only active tiers, cheapest first, with the signup pause flag', async () => {
    const db = getCurrentTestDb()
    await seedTier(db, SITE, { name: 'Gold', price: 2000 })
    await seedTier(db, SITE, { name: 'Bronze', price: 500 })
    await seedTier(db, SITE, { name: 'Retired', price: 100, isActive: false })
    await seedTier(db, OTHER, { name: 'Foreign', price: 1 })

    const res = await (membershipsHandler as Handler)(ev()) as { tiers: { name: string }[]; signupsDisabled: boolean; signupsDisabledMessage: string }
    expect(res.tiers.map(t => t.name)).toEqual(['Bronze', 'Gold'])
    expect(res.signupsDisabled).toBe(false)
    expect(res.signupsDisabledMessage).toBe('New signups are temporarily paused.')

    await seedSetting(db, SITE, 'payments.signups_disabled', 'true')
    await seedSetting(db, SITE, 'payments.signups_disabled_message', 'Back soon')
    const paused = await (membershipsHandler as Handler)(ev()) as { signupsDisabled: boolean; signupsDisabledMessage: string }
    expect(paused).toMatchObject({ signupsDisabled: true, signupsDisabledMessage: 'Back soon' })
  })
})

describe('GET /api/public/menus/:location', () => {
  it('returns this site\'s menu for the location, or null', async () => {
    const db = getCurrentTestDb()
    await db.insert(menus).values([
      { id: ulid(), siteId: SITE, name: 'Header', location: 'header', items: [{ label: 'Home', url: '/' }] },
      { id: ulid(), siteId: OTHER, name: 'Foreign footer', location: 'footer', items: [] },
    ])
    expect(await (menuHandler as Handler)(ev({ params: { location: 'header' } }))).toMatchObject({ name: 'Header', items: [{ label: 'Home', url: '/' }] })
    expect(await (menuHandler as Handler)(ev({ params: { location: 'footer' } }))).toBeNull()
  })
})

describe('GET /api/public/taxonomy/:taxonomy/:term', () => {
  it('lists only public, published items tagged with the term, with pagination metadata', async () => {
    const db = getCurrentTestDb()
    const postType = await seedContentType(db, SITE, { slug: 'post', name: 'Post' })
    const taxId = ulid()
    const termId = ulid()
    await db.insert(taxonomies).values({ id: taxId, siteId: SITE, slug: 'topics', name: 'Topics' })
    await db.insert(taxonomyTerms).values({ id: termId, taxonomyId: taxId, slug: 'nuxt', name: 'Nuxt' })
    const pub = await seedContentItem(db, SITE, postType, { title: 'Public post' })
    const priv = await seedContentItem(db, SITE, postType, { title: 'Private post', visibility: 'private' })
    const draft = await seedContentItem(db, SITE, postType, { title: 'Draft post', status: 'draft' })
    await db.insert(contentTaxonomyTerms).values([pub, priv, draft].map(contentItemId => ({ contentItemId, termId })))

    const res = await (taxonomyHandler as Handler)(ev({ params: { taxonomySlug: 'topics', termSlug: 'nuxt' } })) as {
      term: { name: string }; items: { title: string }[]; total: number; totalPages: number
    }
    expect(res.term.name).toBe('Nuxt')
    expect(res.items.map(i => i.title)).toEqual(['Public post'])
    expect(res.total).toBe(1)
    expect(res.totalPages).toBe(1)
  })

  it('404s for an unknown taxonomy or term, and for another site\'s taxonomy', async () => {
    await expect((taxonomyHandler as Handler)(ev({ params: { taxonomySlug: 'nope', termSlug: 'x' } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((taxonomyHandler as Handler)(ev({ params: { taxonomySlug: 'topics', termSlug: 'nope' } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((taxonomyHandler as Handler)(ev({ siteId: OTHER, params: { taxonomySlug: 'topics', termSlug: 'nuxt' } }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/public/auth/registration-status', () => {
  it('is disabled by default and only enabled by the exact "true" setting', async () => {
    expect(await (registrationStatusHandler as Handler)(ev({ siteId: EMPTY }))).toEqual({ enabled: false })
    await seedSetting(getCurrentTestDb(), EMPTY, 'auth.allow_public_registration', 'true')
    expect(await (registrationStatusHandler as Handler)(ev({ siteId: EMPTY }))).toEqual({ enabled: true })
  })

  it('reports disabled when no site resolved', async () => {
    const event = ev()
    ;(event as unknown as { context: { siteId?: string } }).context.siteId = undefined
    expect(await (registrationStatusHandler as Handler)(event)).toEqual({ enabled: false })
  })
})

describe('GET /api/public/dynamic-plugins', () => {
  it('lists only this site\'s plugins, exposing no code or signing material', async () => {
    const db = getCurrentTestDb()
    await db.insert(dynamicPlugins).values({
      id: 'com.example.mine', siteId: SITE, name: 'Mine', version: '1.0.0', isActive: true, hasClient: true,
      hasServer: true, serverChecksum: 'deadbeef', clientChecksum: 'cafebabe',
      blockDefinitions: [{ id: 'b1', name: 'Block' }],
    })
    const res = await (pluginsHandler as Handler)(ev()) as { plugins: Record<string, unknown>[] }
    expect(res.plugins).toEqual([
      { id: 'com.example.mine', isActive: true, hasClient: true, blockDefinitions: [{ id: 'b1', name: 'Block' }] },
    ])
    const foreign = await (pluginsHandler as Handler)(ev({ siteId: OTHER })) as { plugins: unknown[] }
    expect(foreign.plugins).toEqual([])
  })
})

describe('GET /sitemap-images.xml', () => {
  it('lists this site\'s images with escaped metadata, skipping data: URIs and non-images', async () => {
    const db = getCurrentTestDb()
    await seedMedia(db, SITE, { url: 'https://cdn.example.com/a.jpg', altText: 'Fish & chips', caption: '<b>c</b>' })
    await seedMedia(db, SITE, { url: 'data:image/png;base64,AAAA' })
    await seedMedia(db, SITE, { url: 'https://cdn.example.com/doc.pdf', mimeType: 'application/pdf' })
    await seedMedia(db, SITE, { url: '/_nuxflow/media/site/rel.png', mimeType: 'image/png' })
    await seedMedia(db, OTHER, { url: 'https://cdn.example.com/foreign.jpg' })

    const xml = await (imageSitemapHandler as Handler)(ev()) as string
    expect(xml).toContain('<loc>https://pub.localhost/</loc>')
    expect(xml).toContain('<image:loc>https://cdn.example.com/a.jpg</image:loc>')
    expect(xml).toContain('<image:title>Fish &amp; chips</image:title>')
    expect(xml).toContain('<image:caption>&lt;b&gt;c&lt;/b&gt;</image:caption>')
    expect(xml).toContain('<image:loc>https://pub.localhost/_nuxflow/media/site/rel.png</image:loc>')
    expect(xml).not.toContain('data:image')
    expect(xml).not.toContain('doc.pdf')
    expect(xml).not.toContain('foreign.jpg')
  })

  it('prefers the seo.canonical_url setting as the base URL', async () => {
    await seedSetting(getCurrentTestDb(), SITE, 'seo.canonical_url', 'https://www.canonical.test')
    const xml = await (imageSitemapHandler as Handler)(ev()) as string
    expect(xml).toContain('<loc>https://www.canonical.test/</loc>')
  })
})
