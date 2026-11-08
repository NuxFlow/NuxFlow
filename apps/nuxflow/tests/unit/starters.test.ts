import { describe, it, expect } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import {
  catalogSigningInput,
  fillStarterPlaceholders,
  isSafeStarterPath,
  planStarterSettings,
  rewriteStarterImageRefs,
  settingFingerprint,
  starterSettingKind,
  summarizeCatalogEntry,
} from '../../shared/lib/starters'
import { isAllowedCatalogUrl, verifyStarterCatalog } from '../../server/utils/starters/catalog'
import { buildStarter, catalogPayload, imageRefsIn, readStarterMeta } from '../../scripts/starters/lib'
import { builtinStarterSummaries, getBuiltinStarter } from '../../server/utils/starters/builtin'

const b64url = (b: ArrayBuffer) => Buffer.from(new Uint8Array(b)).toString('base64url')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const enc = (s: string) => new TextEncoder().encode(s)

async function keyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  return { pair, publicKey: b64url(await webcrypto.subtle.exportKey('spki', pair.publicKey)) }
}

async function signedCatalog(payload: string, privateKey: CryptoKey) {
  const signature = b64url(await webcrypto.subtle.sign({ name: 'Ed25519' }, privateKey, catalogSigningInput(payload)))
  return JSON.stringify({ format: 'nuxflow-starter-catalog', version: 1, payload, signature })
}

function sampleStarter() {
  const demo = JSON.stringify({ content: [{ slug: 'home', content: { src: 'images/hero.jpg', html: '<img src=\\"images/a/b.png\\">' } }] })
  return buildStarter(
    { id: 'cafe', name: 'Café', description: 'A café', category: 'Food', version: '1.2.0' },
    [
      { path: 'demo.json', bytes: enc(demo) },
      { path: 'theme.css', bytes: enc(':root{}') },
      { path: 'preview.jpg', bytes: enc('preview') },
      { path: 'images/hero.jpg', bytes: enc('hero-bytes') },
      { path: 'images/a/b.png', bytes: enc('png-bytes') },
      { path: 'images/unused.jpg', bytes: enc('x') },
    ],
    sha256,
  )
}

describe('starter catalog paths', () => {
  it('accepts only relative paths inside the catalog folder', () => {
    expect(isSafeStarterPath('cafe/1.0.0/images/a.jpg')).toBe(true)
    for (const bad of ['../secret', '/abs', 'a//b', 'a/./b', 'https://x/y', 'a?b', 'a\\b']) {
      expect(isSafeStarterPath(bad)).toBe(false)
    }
  })

  it('only fetches the catalog over https (or from localhost for testing)', () => {
    expect(isAllowedCatalogUrl('https://starters.nuxflow.dev/catalog.json')).toBe(true)
    expect(isAllowedCatalogUrl('http://localhost:8080/catalog.json')).toBe(true)
    expect(isAllowedCatalogUrl('http://starters.nuxflow.dev/catalog.json')).toBe(false)
    expect(isAllowedCatalogUrl('https://user:pw@x.test/c.json')).toBe(false)
    expect(isAllowedCatalogUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('building a starter (scripts/starters/lib.ts)', () => {
  it('publishes demo, theme, preview and only the images demo.json uses, under <id>/<version>/', () => {
    const { entry, files, warnings } = sampleStarter()
    expect(entry.demo.path).toBe('cafe/1.2.0/demo.json')
    expect(entry.css?.path).toBe('cafe/1.2.0/theme.css')
    expect(entry.preview?.path).toBe('cafe/1.2.0/preview.jpg')
    expect(entry.images.map(i => i.ref)).toEqual(['images/a/b.png', 'images/hero.jpg'])
    expect(entry.images[1]!.sha256).toBe(sha256(enc('hero-bytes')))
    expect(files.map(f => f.key)).not.toContain('cafe/1.2.0/images/unused.jpg')
    expect(warnings.some(w => w.includes("aren't used"))).toBe(true)
  })

  it('warns about an image demo.json mentions but the folder lacks', () => {
    const { entry, warnings } = buildStarter(
      { id: 'x1', name: 'X', description: '', category: 'General', version: '1' },
      [{ path: 'demo.json', bytes: enc('{"a":"images/missing.png"}') }],
      sha256,
    )
    expect(entry.images).toEqual([])
    expect(warnings.some(w => w.includes('images/missing.png'))).toBe(true)
  })

  it('reads starter.json, falling back to theme.json and the folder name', () => {
    expect(readStarterMeta('Hollis Reed', null, { name: 'Hollis Reed', version: '2.0.0' }))
      .toMatchObject({ id: 'hollis-reed', name: 'Hollis Reed', version: '2.0.0', category: 'General' })
    expect(readStarterMeta('folder', { id: 'own-id', category: 'Photography' }, null))
      .toMatchObject({ id: 'own-id', category: 'Photography' })
  })

  it('finds image references, also inside escaped HTML', () => {
    expect([...imageRefsIn('"images/a.jpg" <img src=\\"images/b.webp\\">')]).toEqual(['images/a.jpg', 'images/b.webp'])
  })

  it('refuses two starters with the same id', () => {
    const { entry } = sampleStarter()
    expect(() => catalogPayload([entry, entry])).toThrow(/have the id "cafe"/)
  })
})

describe('verifying the catalog', () => {
  it('accepts a catalog signed with the pinned key and rejects any change to it', async () => {
    const { pair, publicKey } = await keyPair()
    const payload = JSON.stringify(catalogPayload([sampleStarter().entry]))
    const text = await signedCatalog(payload, pair.privateKey)
    const starters = await verifyStarterCatalog(text, publicKey)
    expect(starters.map(s => s.id)).toEqual(['cafe'])

    const tampered = JSON.parse(text)
    tampered.payload = tampered.payload.replace('A café', 'Evil')
    await expect(verifyStarterCatalog(JSON.stringify(tampered), publicKey)).rejects.toThrow(/signature/)

    const other = await keyPair()
    await expect(verifyStarterCatalog(text, other.publicKey)).rejects.toThrow(/signature/)
    await expect(verifyStarterCatalog('not json', publicKey)).rejects.toThrow(/format/)
  })

  it('summarizes an entry with its preview resolved against the catalog address', () => {
    const summary = summarizeCatalogEntry(sampleStarter().entry, 'https://starters.example/catalog.json')
    expect(summary).toMatchObject({
      id: 'cafe', source: 'catalog', imageCount: 2, needsStorage: true,
      previewUrl: 'https://starters.example/cafe/1.2.0/preview.jpg',
    })
  })
})

describe('demo.json rewriting', () => {
  it('swaps image references for uploaded URLs, longest first, JSON-escaped', () => {
    const text = '{"a":"images/a.jpg","b":"images/a.jpg.webp","c":"<img src=\\"images/a.jpg\\">"}'
    const out = rewriteStarterImageRefs(text, { 'images/a.jpg': '/_nuxflow/media/s/1-a.jpg', 'images/a.jpg.webp': 'https://cdn/"x"' })
    expect(JSON.parse(out)).toEqual({ a: '/_nuxflow/media/s/1-a.jpg', b: 'https://cdn/"x"', c: '<img src="/_nuxflow/media/s/1-a.jpg">' })
  })

  it('fills in the site name safely', () => {
    const out = fillStarterPlaceholders('{"t":"Welcome to {{site_name}}"}', 'Bob\'s "Café"')
    expect(JSON.parse(out).t).toBe('Welcome to Bob\'s "Café"')
  })
})

describe('which settings a starter may write', () => {
  it('allows design settings, fills brand ones only, and ignores everything else', () => {
    expect(starterSettingKind('theme.primary_color')).toBe('design')
    expect(starterSettingKind('frontend.show_header')).toBe('design')
    expect(starterSettingKind('appearance.custom_head_html')).toBe('design')
    expect(starterSettingKind('appearance.logo_url')).toBe('fill')
    expect(starterSettingKind('seo.title')).toBe('fill')
    for (const key of ['seo.canonical_url', 'seo.robots', 'seo.ai_crawlers', 'payments.stripe_secret_key', 'auth.allow_public_registration', 'theme.base_theme_id']) {
      expect(starterSettingKind(key)).toBeNull()
    }
  })

  const fp = settingFingerprint
  it('keeps the owner\'s own brand and custom code, writes design settings', () => {
    const plan = planStarterSettings(
      { 'theme.primary_color': '#111', 'appearance.logo_url': '/new.png', 'appearance.custom_head_html': '<link fonts>', 'seo.canonical_url': 'https://other.site' },
      new Map([['theme.primary_color', fp('#999')], ['appearance.logo_url', fp('/mine.png')], ['appearance.custom_head_html', fp('<script>analytics</script>')]]),
      {},
      fp,
    )
    expect(plan.write).toEqual([['theme.primary_color', '#111']])
    expect(plan.kept.sort()).toEqual(['appearance.custom_head_html', 'appearance.logo_url'])
    expect(plan.clear).toEqual([])
  })

  it('treats values the last starter wrote as unset, and clears the ones the new starter lacks', () => {
    const previous = { 'appearance.custom_head_html': fp('<link old>'), 'theme.dark_mode': fp('dark'), 'theme.primary_color': fp('#c8a57a') }
    const plan = planStarterSettings(
      { 'appearance.custom_head_html': '<link new>' },
      new Map([
        ['appearance.custom_head_html', fp('<link old>')],
        ['theme.dark_mode', fp('dark')],
        // Changed by the owner since: stays.
        ['theme.primary_color', fp('#00ff00')],
      ]),
      previous,
      fp,
    )
    expect(plan.write).toEqual([['appearance.custom_head_html', '<link new>']])
    expect(plan.clear).toEqual(['theme.dark_mode'])
  })
})

describe('built-in starters', () => {
  it('are the four original templates, all text only', () => {
    expect(builtinStarterSummaries().map(s => s.id)).toEqual(['landing', 'blog', 'portfolio', 'blank'])
    expect(builtinStarterSummaries().every(s => !s.needsStorage && s.source === 'builtin')).toBe(true)
  })

  it('build a homepage with the site name, and the blog one a welcome post', () => {
    const landing = getBuiltinStarter('landing')!.build('Acme')
    expect(landing.content.map(c => c.slug)).toEqual(['home'])
    expect(landing.content[0]!.title).toBe('Acme')
    expect(JSON.stringify(landing.content[0]!.content)).toContain('Welcome to Acme')
    expect(getBuiltinStarter('blog')!.build('Acme').content.map(c => c.slug)).toEqual(['home', 'hello-world'])
  })
})

describe('reading a starter demo.json', () => {
  it('accepts a theme-bundle demo.json with a numeric version and missing sections', async () => {
    const { parseStarterDemo } = await import('../../server/utils/starters/demo')
    const backup = parseStarterDemo(JSON.stringify({
      version: 1,
      settings: { 'theme.primary_color': '#fff' },
      content: [{ typeSlug: 'page', slug: 'home', title: 'Home', status: 'published', visibility: 'public', content: {}, excerpt: null, seoTitle: null, seoDescription: null, ogImage: null, publishedAt: null, settings: null, termSlugs: [], locale: null, sourceItemSlug: null }],
      users: [{ email: 'x@y.z', role: 'admin' }],
    }))
    expect(backup.content).toHaveLength(1)
    expect(backup.users).toEqual([])
  })

  it('explains what is wrong', async () => {
    const { parseStarterDemo } = await import('../../server/utils/starters/demo')
    expect(() => parseStarterDemo('nope')).toThrow(/not valid JSON/)
    expect(() => parseStarterDemo('{"content":[{"slug":1}]}')).toThrow(/content\.0/)
  })
})
