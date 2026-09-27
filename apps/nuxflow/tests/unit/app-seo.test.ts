import { describe, it, expect } from 'vitest'
import { absolutize, buildPageJsonLd, extractFaqItems, localePath, ogLocale, toIsoDate } from '../../app/utils/seo'
import { seoFormFromSettings, seoFormToSettings } from '../../app/utils/seo-admin'
import { buildSeoAudit, type AuditItemInput } from '../../server/utils/seo-audit'
import { parseSeoSettings } from '../../server/utils/seo'
import { extractImageUrls, looksLikeImageUrl } from '../../server/utils/sitemap-entries'

const site = { name: 'Acme', base: 'https://acme.test', logoUrl: 'https://acme.test/logo.png' }

describe('app seo helpers', () => {
  it('toIsoDate converts SQLite timestamps', () => {
    expect(toIsoDate('2026-01-02 03:04:05')).toBe('2026-01-02T03:04:05Z')
    expect(toIsoDate(undefined)).toBeUndefined()
  })

  it('absolutize resolves site-relative URLs and drops data: URIs', () => {
    expect(absolutize('/_nuxflow/media/a.png', 'https://acme.test/')).toBe('https://acme.test/_nuxflow/media/a.png')
    expect(absolutize('https://cdn.test/a.png', 'https://acme.test')).toBe('https://cdn.test/a.png')
    expect(absolutize('data:image/png;base64,AA', 'https://acme.test')).toBeUndefined()
  })

  it('localePath matches the server\'s public paths (no trailing slash for a translated homepage)', () => {
    expect(localePath('en', 'about', 'en')).toBe('/about')
    expect(localePath('en', 'home', 'en')).toBe('/')
    expect(localePath('es', 'about', 'en')).toBe('/es/about')
    expect(localePath('es', 'home', 'en')).toBe('/es')
  })

  it('ogLocale converts region separators', () => {
    expect(ogLocale('zh-CN')).toBe('zh_CN')
    expect(ogLocale(null)).toBeUndefined()
  })

  it('extractFaqItems reads accordion Q&As, including nested ones, and skips incomplete pairs', () => {
    const content = {
      type: 'canvas',
      blocks: [
        { type: 'canvas-accordion', props: { itemsJson: '[{"question":"Q1","answer":"A1"},{"question":"No answer","answer":""}]' } },
        { type: 'canvas-columns', props: {}, children: { col1: [{ type: 'canvas-accordion', props: { itemsJson: [{ question: 'Q2', answer: 'A2' }] } }] } },
        { type: 'canvas-accordion', props: { itemsJson: 'not json' } },
      ],
    }
    expect(extractFaqItems(content)).toEqual([{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }])
    expect(extractFaqItems({ type: 'doc', content: [] })).toEqual([])
  })
})

describe('buildPageJsonLd', () => {
  it('uses BlogPosting for posts, with ISO dates, author, publisher logo, and a Blog breadcrumb', () => {
    const [post, crumbs] = buildPageJsonLd({
      title: 'Hello',
      url: 'https://acme.test/hello',
      publishedAt: '2026-01-02 03:04:05',
      updatedAt: '2026-01-03 03:04:05',
      author: { name: 'Jane', image: null },
      type: { slug: 'post', name: 'Post' },
    }, site)
    expect(post!['@type']).toBe('BlogPosting')
    expect(post!.datePublished).toBe('2026-01-02T03:04:05Z')
    expect(post!.dateModified).toBe('2026-01-03T03:04:05Z')
    expect(post!.author).toEqual({ '@type': 'Person', name: 'Jane' })
    expect((post!.publisher as { logo: { url: string } }).logo.url).toBe('https://acme.test/logo.png')
    expect(crumbs!['@type']).toBe('BreadcrumbList')
    expect((crumbs!.itemListElement as { name: string }[]).map(c => c.name)).toEqual(['Acme', 'Blog', 'Hello'])
  })

  it('uses WebPage for ordinary pages and omits the breadcrumb on the homepage', () => {
    const out = buildPageJsonLd({ title: 'Home', url: 'https://acme.test/', isHome: true, type: { slug: 'page', name: 'Page' } }, site)
    expect(out.map(o => o['@type'])).toEqual(['WebPage'])
  })

  it('uses Event for events, with place or online location', () => {
    const [inPerson] = buildPageJsonLd({
      title: 'Meetup',
      url: 'https://acme.test/meetup',
      type: { slug: 'event', name: 'Event' },
      event: { startAt: '2026-10-01T18:00:00.000Z', endAt: '2026-10-01T20:00:00.000Z', location: 'Town Hall' },
    }, site)
    expect(inPerson!['@type']).toBe('Event')
    expect(inPerson!.location).toEqual({ '@type': 'Place', name: 'Town Hall', address: 'Town Hall' })
    expect(inPerson!.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode')

    const [online] = buildPageJsonLd({
      title: 'Webinar',
      url: 'https://acme.test/webinar',
      type: { slug: 'event', name: 'Event' },
      event: { startAt: '2026-10-01', allDay: true, url: 'https://meet.test/x' },
    }, site)
    expect(online!.startDate).toBe('2026-10-01')
    expect(online!.location).toEqual({ '@type': 'VirtualLocation', url: 'https://meet.test/x' })
  })

  it('adds FAQPage when the page has accordion Q&As, and never emits undefined keys', () => {
    const out = buildPageJsonLd({
      title: 'Help',
      url: 'https://acme.test/help',
      content: { type: 'canvas', blocks: [{ type: 'canvas-accordion', props: { itemsJson: '[{"question":"Q","answer":"A"}]' } }] },
    }, site)
    const faq = out.find(o => o['@type'] === 'FAQPage')!
    expect(faq.mainEntity).toEqual([{ '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } }])
    expect(JSON.stringify(out)).not.toContain('undefined')
    expect(Object.keys(out[0]!)).not.toContain('description')
  })
})

describe('SEO admin form mapping', () => {
  it('round-trips settings through the form, tolerating legacy string booleans', () => {
    const form = seoFormFromSettings({
      'seo.ai_crawlers': 'block-training',
      'seo.llms_enabled': 'false',
      'seo.social_profiles': ['https://a.test', 'https://b.test'],
      'seo.noindex_content_types': ['event'],
    })
    expect(form.aiCrawlers).toBe('block-training')
    expect(form.llmsEnabled).toBe(false)
    expect(form.socialProfiles).toBe('https://a.test\nhttps://b.test')
    const out = seoFormToSettings({ ...form, socialProfiles: ' https://a.test \n\nhttps://c.test' })
    expect(out['seo.social_profiles']).toEqual(['https://a.test', 'https://c.test'])
    expect(out['seo.noindex_content_types']).toEqual(['event'])
    expect(out['seo.llms_enabled']).toBe(false)
    // The IndexNow key is server-generated — never sent back from the form.
    expect(out).not.toHaveProperty('seo.indexnow_key')
  })
})

describe('buildSeoAudit', () => {
  const base: AuditItemInput = {
    id: '1', title: 'A page', path: '/a', typeName: 'Page', isPublic: true, seoTitle: null,
    description: 'A perfectly reasonable description that is long enough to pass the check.', hasOwnDescription: true,
    ogImage: 'https://x.test/a.png', noindex: false, canonicalUrl: null,
  }

  it('flags missing, short, and duplicate descriptions and long titles', () => {
    const res = buildSeoAudit([
      { ...base, id: '1', description: null },
      { ...base, id: '2', description: 'Too short' },
      { ...base, id: '3', title: 'Same', description: 'Duplicate description that is definitely long enough here ok.' },
      { ...base, id: '4', title: 'Same', description: 'Duplicate description that is definitely long enough here ok.' },
      { ...base, id: '5', title: 'x'.repeat(70) },
    ], parseSeoSettings({}), { truncated: false })
    const codes = (id: string) => res.items.find(i => i.id === id)?.issues.map(x => x.code) ?? []
    expect(codes('1')).toContain('missing_description')
    expect(codes('2')).toContain('description_too_short')
    expect(codes('3')).toEqual(expect.arrayContaining(['duplicate_title', 'duplicate_description']))
    expect(codes('5')).toContain('title_too_long')
    expect(res.summary.withIssues).toBe(5)
  })

  it('does not audit members-only pages, reports noindex as info, and respects a site default share image', () => {
    const res = buildSeoAudit([
      { ...base, id: 'm', isPublic: false, description: null },
      { ...base, id: 'n', noindex: true, description: null },
      { ...base, id: 'i', title: 'Image page', description: 'A distinct description for the page that relies on the site default image.', ogImage: null },
      { ...base, id: 'd', title: 'Inline page', description: 'Another distinct description, for the page whose image is stored inline.', ogImage: 'data:image/png;base64,AA' },
    ], parseSeoSettings({ 'seo.og_image': 'https://x.test/default.png' }), { truncated: false })
    expect(res.items.find(i => i.id === 'm')).toBeUndefined()
    expect(res.items.find(i => i.id === 'n')!.issues).toEqual([expect.objectContaining({ code: 'noindex', severity: 'info' })])
    expect(res.items.find(i => i.id === 'i')).toBeUndefined()
    expect(res.items.find(i => i.id === 'd')!.issues.map(x => x.code)).toContain('inline_image')
  })

  it('reports site-level gaps', () => {
    const res = buildSeoAudit([], parseSeoSettings({ 'seo.robots': 'noindex' }), { truncated: false })
    expect(res.site.find(c => c.id === 'noindex')?.severity).toBe('error')
    expect(res.site.find(c => c.id === 'description')?.severity).toBe('warning')
  })
})

describe('image URL extraction (image sitemap)', () => {
  it('recognizes image URLs by extension or known media path', () => {
    expect(looksLikeImageUrl('https://cdn.test/a.JPG?w=100')).toBe(true)
    expect(looksLikeImageUrl('/_nuxflow/media/site/01ABC')).toBe(true)
    expect(looksLikeImageUrl('https://imagedelivery.net/x/y/public')).toBe(true)
    expect(looksLikeImageUrl('https://cdn.test/doc.pdf')).toBe(false)
    expect(looksLikeImageUrl('//cdn.test/a.png')).toBe(false)
    expect(looksLikeImageUrl('i-lucide-image')).toBe(false)
  })

  it('walks TipTap, Canvas props, gallery JSON strings, and rich-text HTML', () => {
    const urls = extractImageUrls({
      type: 'canvas',
      blocks: [
        { props: { src: { url: 'https://cdn.test/1.png' } } },
        { props: { images: '[{"url":"https://cdn.test/2.webp","alt":"x"}]' } },
        { props: { content: '<p><img alt="a" src="https://cdn.test/3.jpg"> <img src=\'/4.gif\'></p>' } },
        { props: { logoIcon: 'i-lucide-star', ctaUrl: '/contact' } },
      ],
    })
    expect(urls.sort()).toEqual(['/4.gif', 'https://cdn.test/1.png', 'https://cdn.test/2.webp', 'https://cdn.test/3.jpg'])
  })

  it('caps the number of images returned', () => {
    const content = { images: Array.from({ length: 20 }, (_, i) => ({ url: `https://cdn.test/${i}.png` })) }
    expect(extractImageUrls(content, 5)).toHaveLength(5)
  })
})
