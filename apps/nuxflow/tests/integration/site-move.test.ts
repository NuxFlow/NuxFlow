/**
 * Phase 6 of plan 13: moving a site between the control plane and a member pool
 * (server/utils/site-move.ts, site-move-job.ts). Two real databases — the control plane's
 * and the pool's — with the pool reached through a fake binding that runs the pool's own
 * code against its own database, so every row really crosses from one to the other.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import {
  contentItems, contentRevisions, contentTaxonomyTerms, emailMessages, hostingPlans, mailboxes, media, redirects,
  siteDirectory, siteDomains, siteMoves, sites, taxonomies, taxonomyTerms, userSiteRoles, users,
} from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb, type TestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedSetting } from '../helpers/seed'

// The pool's requests carry its own database; everything else is the control plane's.
vi.mock('../../server/utils/db', () => ({
  useDb: (event?: { context?: { poolDb?: unknown } }) => event?.context?.poolDb ?? getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/email-template', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTemplatedEmail: vi.fn().mockResolvedValue({}),
}))

const realRuntimeConfig = globalThis.useRuntimeConfig
function setMode(poolId: string | null) {
  globalThis.useRuntimeConfig = (() => ({ ...realRuntimeConfig(), poolId: poolId ?? '' })) as typeof globalThis.useRuntimeConfig
}
setMode(null)

const { startSiteMove, stepSiteMove, cancelSiteMove, getSiteMove } = await import('../../server/utils/site-move-job')
const { poolSiteMove, moveTables, localMoveStore } = await import('../../server/utils/site-move')
const { poolSites } = await import('../../server/utils/pool-admin')
const { poolGetSite, poolSetPlans, listAllSites } = await import('../../server/utils/pool-sites')
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { default: multiSite } = await import('../../server/middleware/02.multi-site')
const { clearSiteCache } = await import('../../server/utils/site-resolution')

type Handler = (e: H3Event) => Promise<unknown>
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }

const PRIMARY = 'site-mv-primary'
const SITE = 'site-mv-cafe'
const POOL = 'clientx'
let poolDb: TestDb
let ownerId: string
let operatorId: string

/** A fake KV namespace with the parts the move uses. */
function fakeKv() {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k: string) => data.get(k) ?? null,
    put: async (k: string, v: string) => { data.set(k, v) },
    delete: async (k: string) => { data.delete(k) },
    list: async ({ prefix }: { prefix?: string }) => ({ keys: [...data.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  }
}
const cpKv = fakeKv()
const poolKv = fakeKv()

/** A fake R2 bucket with the parts a move uses. */
function fakeBucket() {
  const data = new Map<string, { bytes: Uint8Array; httpMetadata?: Record<string, unknown>; customMetadata?: Record<string, string> }>()
  return {
    data,
    async put(key: string, value: unknown, opts: { httpMetadata?: Record<string, unknown>; customMetadata?: Record<string, string> } = {}) {
      data.set(key, { bytes: new Uint8Array(await new Response(value as BodyInit).arrayBuffer()), ...opts })
    },
    async get(key: string) {
      const o = data.get(key)
      return o ? { body: new Response(o.bytes).body, size: o.bytes.byteLength, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null
    },
    async head(key: string) {
      const o = data.get(key)
      return o ? { size: o.bytes.byteLength } : null
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k)
    },
    async list({ prefix = '', cursor, limit = 1000 }: { prefix?: string; cursor?: string; limit?: number }) {
      const all = [...data.keys()].filter(k => k.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      const page = all.slice(start, start + limit)
      const truncated = start + limit < all.length
      return { objects: page.map(key => ({ key, size: data.get(key)!.bytes.byteLength })), truncated, cursor: truncated ? String(start + limit) : undefined }
    },
  }
}
type FakeBucket = ReturnType<typeof fakeBucket>
/** Each side's MEDIA_BUCKET for the test (undefined = none; the same object = a shared bucket). */
const buckets: { cp?: FakeBucket; pool?: FakeBucket } = {}

/** An event inside the pool: its own database and KV. */
function poolEvent(): H3Event {
  const event = createMockEvent({ siteId: undefined, headers: { host: 'localhost' } }) as MockEvent
  event.context.siteId = null
  event.context.poolDb = poolDb
  event.context.cloudflare = { env: { PLUGIN_KV: poolKv, MEDIA_BUCKET: buckets.pool }, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

/** Runs pool code the way its admin entrypoint would: in pool mode, on its own database. */
async function inPool<T>(fn: () => Promise<T>): Promise<T> {
  setMode(POOL)
  try {
    return await fn()
  }
  finally {
    setMode(null)
  }
}

const poolStub = {
  status: async () => ({ protocol: POOL_PROTOCOL, poolId: POOL, commit: null, release: null, siteCount: 0, lastMigration: null, settingsReceivedAt: null }),
  listSites: () => inPool(() => poolSites(poolDb)),
  getSite: (input: { protocol: number; siteId: string }) => inPool(() => poolGetSite(poolEvent(), input)),
  setPlans: (input: Parameters<typeof poolSetPlans>[1]) => inPool(() => poolSetPlans(poolEvent(), input)),
  siteMove: (input: Parameters<typeof poolSiteMove>[1]) => inPool(() => poolSiteMove(poolEvent(), input)),
}

function cpEvent(opts: Parameters<typeof createMockEvent>[0] = {}): H3Event {
  const event = createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' }, ...opts }) as MockEvent
  event.context.cloudflare = { env: { PLUGIN_KV: cpKv, POOL_CLIENTX: poolStub, MEDIA_BUCKET: buckets.cp }, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

/** Drives a move to the end, skipping the waits by moving the clock marks back. */
async function runMove(id: string, stopAt?: string) {
  for (let i = 0; i < 200; i++) {
    const move = await getSiteMove(getCurrentTestDb(), id)
    if (stopAt && move.phase === stopAt) return move
    await getCurrentTestDb().update(siteMoves).set({ lockedAt: '2000-01-01T00:00:00.000Z', switchedAt: move.switchedAt ? '2000-01-01T00:00:00.000Z' : null }).where(eq(siteMoves.id, id))
    const result = await stepSiteMove(cpEvent(), id)
    if (result.move.error && result.move.phase !== 'failed') throw new Error(result.move.error)
    if (!result.more) return result.move
  }
  throw new Error('The move never finished')
}

/** Rows per table for the site in one database. */
async function countsIn(db: TestDb) {
  const event = createMockEvent({ siteId: null }) as MockEvent
  event.context.poolDb = db
  event.context.cloudflare = { env: {}, context: { waitUntil: () => {} } }
  return localMoveStore(event as unknown as H3Event).counts(SITE)
}

let originalCounts: Record<string, number>
let translationId: string
let sourceId: string

async function seedCafe() {
  const db = getCurrentTestDb()
  await db.insert(hostingPlans).values({ id: 'plan-mv', name: 'Business' }).onConflictDoNothing()
  await seedSite(db, { id: SITE, domain: 'cafe.sites.test', name: 'The Café', hostingPlanId: 'plan-mv' })
  await seedRole(db, ownerId, SITE, 'admin')
  await seedSetting(db, SITE, 'site.tagline', 'Coffee and cake')
  const typeId = await seedContentType(db, SITE, { slug: 'post' })
  sourceId = await seedContentItem(db, SITE, typeId, { slug: 'hello', title: 'Hello', authorId: ownerId })
  translationId = await seedContentItem(db, SITE, typeId, { slug: 'hello-es', title: 'Hola', authorId: ownerId })
  await db.update(contentItems).set({ sourceItemId: sourceId, locale: 'es' }).where(eq(contentItems.id, translationId))
  await db.insert(contentRevisions).values({ id: ulid(), itemId: sourceId, title: 'Hello v1', content: {}, authorId: ownerId })
  const taxId = ulid()
  await db.insert(taxonomies).values({ id: taxId, siteId: SITE, slug: 'category', name: 'Categories' })
  const termId = ulid()
  await db.insert(taxonomyTerms).values({ id: termId, taxonomyId: taxId, slug: 'news', name: 'News' })
  await db.insert(contentTaxonomyTerms).values({ contentItemId: sourceId, termId })
  await seedMedia(db, SITE, { uploadedBy: ownerId })
  await db.insert(mailboxes).values({ id: ulid(), siteId: SITE, kind: 'inbox', localPart: 'hello', name: 'Hello' })
  await db.insert(emailMessages).values({ id: ulid(), siteId: SITE, direction: 'inbound', fromAddress: 'a@b.test', toAddress: 'hello@cafe.sites.test', subject: 'Hi', threadId: 't1' })
  await db.insert(siteDomains).values({ id: ulid(), siteId: SITE, hostname: 'www.cafe.co.uk', kind: 'custom', status: 'active' })
  await db.insert(redirects).values({ id: ulid(), siteId: SITE, from: '/old', to: '/new', statusCode: 301 })
  cpKv.data.set(`theme:${SITE}:t1:css:v1`, 'body{color:red}')
  cpKv.data.set(`plugin:${SITE}:p1:server:abc`, 'export default {}')
  cpKv.data.set('theme:someone-else:t1:css:v1', 'keep me')
  originalCounts = await countsIn(getCurrentTestDb())
}

beforeAll(async () => {
  poolDb = await initTestDb() // the pool's database (initTestDb leaves it open)
  await initTestDb() // the control plane's, now the current one
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, name: 'Platform' })
  operatorId = await seedUser(db, { email: 'op@mv.test' })
  ownerId = await seedUser(db, { email: 'owner@mv.test', name: 'Owner' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
})

afterAll(async () => {
  globalThis.useRuntimeConfig = realRuntimeConfig
  await teardownTestDb()
})

beforeEach(async () => {
  for (const db of [getCurrentTestDb(), poolDb]) {
    await db.delete(sites).where(eq(sites.id, SITE))
    await db.delete(siteDirectory)
  }
  await getCurrentTestDb().delete(siteMoves)
  await poolDb.delete(users)
  for (const kv of [cpKv, poolKv]) kv.data.clear()
  buckets.cp = undefined
  buckets.pool = undefined
  clearSiteCache()
  await seedCafe()
})

describe('what a site owns', () => {
  it('reads every site table from the schema, parents first, without sign-in state', () => {
    const names = moveTables().map(t => t.name)
    expect(names[0]).toBe('sites')
    for (const t of ['content_items', 'content_revisions', 'taxonomy_terms', 'content_taxonomy_terms', 'email_messages', 'site_domains', 'plugin_storage', 'subscriptions', 'mailing_list_subscribers'])
      expect(names).toContain(t)
    expect(names).not.toContain('site_sessions')
    expect(names).not.toContain('site_auth_codes')
    expect(names).not.toContain('users')
    expect(names.indexOf('content_types')).toBeLessThan(names.indexOf('content_items'))
    expect(names.indexOf('content_items')).toBeLessThan(names.indexOf('content_revisions'))
    expect(names.indexOf('taxonomies')).toBeLessThan(names.indexOf('taxonomy_terms'))
    expect(moveTables().find(t => t.name === 'content_items')!.selfColumns).toEqual(['source_item_id'])
  })
})

describe('moving a site from the control plane into a pool', () => {
  it('copies every row with the same ids, its KV, and its users; then routes it and removes the old copy', async () => {
    const started = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    expect(started.phase).toBe('locking')
    const [locked] = await getCurrentTestDb().select().from(sites).where(eq(sites.id, SITE))
    expect(locked!.moveState).toBe('outgoing')

    const done = await runMove(started.id)
    expect(done).toMatchObject({ phase: 'done', error: null })

    // Every table, row for row, in the pool — and nothing left here.
    expect(await countsIn(poolDb)).toEqual(originalCounts)
    expect(Object.values(await countsIn(getCurrentTestDb())).every(n => n === 0)).toBe(true)
    const [moved] = await poolDb.select().from(sites).where(eq(sites.id, SITE))
    expect(moved).toMatchObject({ domain: 'cafe.sites.test', moveState: null, isPrimary: false, hostingPlanId: 'plan-mv' })
    const [translation] = await poolDb.select().from(contentItems).where(eq(contentItems.id, translationId))
    expect(translation!.sourceItemId).toBe(sourceId)
    // The pool has a copy of the owner (and the plan) the rows refer to.
    expect((await poolDb.select().from(users)).map(u => u.email)).toEqual(['owner@mv.test'])
    expect(await poolDb.select({ role: userSiteRoles.role }).from(userSiteRoles).where(eq(userSiteRoles.siteId, SITE))).toEqual([{ role: 'admin' }])
    expect(await poolDb.select({ id: hostingPlans.id }).from(hostingPlans)).toEqual([{ id: 'plan-mv' }])

    expect([...poolKv.data.keys()].sort()).toEqual([`plugin:${SITE}:p1:server:abc`, `theme:${SITE}:t1:css:v1`])
    expect([...cpKv.data.keys()].filter(k => k.includes(SITE))).toEqual([])
    expect(cpKv.data.get('theme:someone-else:t1:css:v1')).toBe('keep me')

    // The router sends both addresses to the pool.
    const routes = await getCurrentTestDb().select().from(siteDirectory)
    expect(routes.map(r => [r.hostname, r.poolId]).sort()).toEqual([['cafe.sites.test', POOL], ['www.cafe.co.uk', POOL]])
    expect(cpKv.data.get('pool-route:cafe.sites.test')).toBe(POOL)

    const list = await listAllSites(cpEvent())
    expect(list.sites.filter(s => s.id === SITE)).toEqual([expect.objectContaining({ poolId: POOL, moving: false })])
  })

  it('moves back to the control plane the same way', async () => {
    await runMove((await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)).id)
    const back = await startSiteMove(cpEvent(), { siteId: SITE, toPool: null }, operatorId)
    expect(back.fromPool).toBe(POOL)
    expect(await runMove(back.id)).toMatchObject({ phase: 'done' })
    expect(await countsIn(getCurrentTestDb())).toEqual(originalCounts)
    expect(Object.values(await countsIn(poolDb)).every(n => n === 0)).toBe(true)
    expect(await getCurrentTestDb().select().from(siteDirectory)).toEqual([])
    const [here] = await getCurrentTestDb().select().from(sites).where(eq(sites.id, SITE))
    expect(here!.moveState).toBeNull()
  })

  it("leaves out what belongs to an account that no longer exists, as deleting it would have, and still finishes", async () => {
    await runMove((await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)).id)
    // A user the pool still has a copy of, whose account is gone from the control plane.
    const ghost = await seedUser(poolDb, { email: 'ghost@mv.test' })
    await seedRole(poolDb, ghost, SITE, 'editor')
    const mediaId = await seedMedia(poolDb, SITE, { uploadedBy: ghost })

    const back = await runMove((await startSiteMove(cpEvent(), { siteId: SITE, toPool: null }, operatorId)).id)
    expect(back).toMatchObject({ phase: 'done', error: null })
    expect(await getCurrentTestDb().select().from(userSiteRoles).where(eq(userSiteRoles.userId, ghost))).toEqual([])
    const [file] = await getCurrentTestDb().select({ uploadedBy: media.uploadedBy }).from(media).where(eq(media.id, mediaId))
    expect(file).toEqual({ uploadedBy: null })
  })

  it('locks the site while it moves: visitors see maintenance, changes are refused', async () => {
    await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    clearSiteCache()
    const visit = async (method: string, path: string) => {
      const event = createMockEvent({ siteId: undefined, method, headers: { host: 'cafe.sites.test' } }) as unknown as Record<string, unknown>
      event.path = path
      event.method = method
      return { body: await (multiSite as Handler)(event as unknown as H3Event), event: event as unknown as { context: { siteId: string } } }
    }
    const page = await visit('GET', '/about')
    expect(String(page.body)).toContain('Down for maintenance')
    expect(await visit('POST', '/api/v1/content')).toMatchObject({ body: { statusCode: 503 } })
    const admin = await visit('GET', '/api/v1/content')
    expect(admin.body).toBeUndefined()
    expect(admin.event.context.siteId).toBe(SITE)
  })

  it('copies mail that arrives during the move before switching', async () => {
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    await runMove(move.id, 'checking')
    // Arrives after the inbox was copied, before the switch.
    await getCurrentTestDb().insert(emailMessages).values({ id: 'late-mail', siteId: SITE, direction: 'inbound', fromAddress: 'c@d.test', toAddress: 'hello@cafe.sites.test', subject: 'Late', threadId: 't2' })
    expect(await runMove(move.id)).toMatchObject({ phase: 'done' })
    expect((await poolDb.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.id, 'late-mail')))).toHaveLength(1)
  })

  it("stops, without switching, when the copy doesn't match", async () => {
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    await runMove(move.id, 'checking')
    await getCurrentTestDb().insert(redirects).values({ id: ulid(), siteId: SITE, from: '/sneaky', to: '/', statusCode: 301 })
    const failed = await runMove(move.id)
    expect(failed.phase).toBe('failed')
    expect(failed.error).toMatch(/redirects \(2 vs 1\)/)
    expect(await getCurrentTestDb().select().from(siteDirectory)).toEqual([])

    // Cancelling removes the copy and unlocks the site, which never left.
    expect((await cancelSiteMove(cpEvent(), move.id, operatorId)).phase).toBe('cancelled')
    expect(Object.values(await countsIn(poolDb)).every(n => n === 0)).toBe(true)
    const [here] = await getCurrentTestDb().select().from(sites).where(eq(sites.id, SITE))
    expect(here!.moveState).toBeNull()
  })

  it('keeps a half-written copy out of the pool\'s list, and can be cancelled part-way', async () => {
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    await getCurrentTestDb().update(siteMoves).set({ lockedAt: '2000-01-01T00:00:00.000Z' }).where(eq(siteMoves.id, move.id))
    await stepSiteMove(cpEvent(), move.id) // locking → copying
    await stepSiteMove(cpEvent(), move.id) // copies (all of it, at this size)
    expect((await poolDb.select({ s: sites.moveState }).from(sites).where(eq(sites.id, SITE)))[0]?.s).toBe('incoming')
    expect(await poolStub.listSites()).toEqual([])
    expect((await listAllSites(cpEvent())).sites.filter(s => s.id === SITE)).toEqual([expect.objectContaining({ poolId: null, moving: true })])

    await cancelSiteMove(cpEvent(), move.id, operatorId)
    expect(await poolDb.select().from(sites).where(eq(sites.id, SITE))).toEqual([])
  })

  it('refuses the main site, a site already moving, a move to where it is, and an address taken at the destination', async () => {
    await expect(startSiteMove(cpEvent(), { siteId: PRIMARY, toPool: POOL }, operatorId)).rejects.toMatchObject({ statusCode: 409 })
    await expect(startSiteMove(cpEvent(), { siteId: SITE, toPool: null }, operatorId)).rejects.toMatchObject({ statusCode: 409 })
    await expect(startSiteMove(cpEvent(), { siteId: SITE, toPool: 'nowhere' }, operatorId)).rejects.toMatchObject({ statusCode: 422 })

    await seedSite(poolDb, { id: 'site-mv-other', domain: 'www.cafe.co.uk', name: 'Squatter' })
    await expect(startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)).rejects.toMatchObject({ statusCode: 409 })
    await poolDb.delete(sites).where(eq(sites.id, 'site-mv-other'))

    await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    await expect(startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('only lets a pool add rows to a copy being moved there, and only removes copies a move left', async () => {
    const pool = (op: Parameters<typeof poolSiteMove>[1]['op']) => poolStub.siteMove({ protocol: POOL_PROTOCOL, siteId: SITE, op })
    await poolDb.insert(sites).values({ id: SITE, name: 'Live in pool', domain: 'live.sites.test' })
    await expect(pool({ op: 'importRows', table: 'redirects', rows: [{ id: 'r1', site_id: SITE, from: '/a', to: '/b', status_code: 301 }] })).rejects.toThrow(/being moved here/)
    await expect(pool({ op: 'purge' })).rejects.toThrow(/left behind by a move/)
    await expect(pool({ op: 'importRows', table: 'sites', rows: [{ id: SITE, name: 'x', domain: 'x.test' }] })).rejects.toThrow(/already has that site/)
    expect(await poolDb.select().from(sites).where(eq(sites.id, SITE))).toHaveLength(1)
    await poolDb.delete(sites).where(eq(sites.id, SITE))
    void sql
  })
})

describe('files, when the destination keeps them in a different bucket (a pool with its own, or an EU pool)', () => {
  const siteFiles = [`${SITE}/cup.jpg`, `${SITE}/themes/hero.png`, `_private/${SITE}/email/m1-abc.eml`]
  async function fill(bucket: FakeBucket) {
    for (const key of siteFiles) await bucket.put(key, `bytes of ${key}`, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { by: 'test' } })
    await bucket.put('someone-else/keep.jpg', 'not ours')
  }

  it('copies every file of the site with its metadata, then removes the old ones and only those', async () => {
    buckets.cp = fakeBucket()
    buckets.pool = fakeBucket()
    await fill(buckets.cp)
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    expect(move.copyFiles).toBe(true)
    expect(await runMove(move.id)).toMatchObject({ phase: 'done', error: null })

    expect([...buckets.pool.data.keys()].sort()).toEqual([...siteFiles].sort())
    const copied = buckets.pool.data.get(siteFiles[0]!)!
    expect(new TextDecoder().decode(copied.bytes)).toBe(`bytes of ${siteFiles[0]}`)
    expect(copied).toMatchObject({ httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { by: 'test' } })
    // The old bucket keeps other sites' files, and no probe is left anywhere.
    expect([...buckets.cp.data.keys()]).toEqual(['someone-else/keep.jpg'])
  })

  it('never copies or deletes anything when both sides share one bucket', async () => {
    const shared = fakeBucket()
    buckets.cp = shared
    buckets.pool = shared
    await fill(shared)
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    expect(move.copyFiles).toBe(false)
    expect(await runMove(move.id)).toMatchObject({ phase: 'done' })
    expect([...shared.data.keys()].sort()).toEqual([...siteFiles, 'someone-else/keep.jpg'].sort())
  })

  it('goes over the files again when one arrives during the move (an email attachment)', async () => {
    buckets.cp = fakeBucket()
    buckets.pool = fakeBucket()
    await fill(buckets.cp)
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    await runMove(move.id, 'checking')
    await buckets.cp.put(`_private/${SITE}/email/late-xyz.eml`, 'late mail')
    expect(await runMove(move.id)).toMatchObject({ phase: 'done', error: null })
    expect(buckets.pool.data.has(`_private/${SITE}/email/late-xyz.eml`)).toBe(true)
  })

  it('cancelling removes the copied files too, and leaves the originals', async () => {
    buckets.cp = fakeBucket()
    buckets.pool = fakeBucket()
    await fill(buckets.cp)
    const move = await startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)
    await runMove(move.id, 'checking')
    expect(buckets.pool.data.size).toBe(3)
    await cancelSiteMove(cpEvent(), move.id, operatorId)
    expect(buckets.pool.data.size).toBe(0)
    expect(buckets.cp.data.size).toBe(4)
  })

  // ("The destination has no storage" isn't testable here: getCfBindings() falls back to the
  // last bucket it saw, per Worker — harmless in production, but both sides share it in tests.)
  it('refuses when the site links files by a public bucket address', async () => {
    buckets.cp = fakeBucket()
    buckets.pool = fakeBucket()
    await seedMedia(getCurrentTestDb(), SITE, { storageProvider: 'r2', url: 'https://pub-123.r2.dev/x.jpg' })
    await expect(startSiteMove(cpEvent(), { siteId: SITE, toPool: POOL }, operatorId)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/public address/) })
    // Nothing was locked, and no probe is left behind.
    const [here] = await getCurrentTestDb().select().from(sites).where(eq(sites.id, SITE))
    expect(here!.moveState).toBeNull()
    expect([...buckets.cp.data.keys()]).toEqual([])
  })

  it("a pool refuses to delete the files of a site that isn't a copy left by a move", async () => {
    buckets.pool = fakeBucket()
    await buckets.pool.put(`${SITE}/cup.jpg`, 'x')
    // Absent from the pool's database: its files may belong to the live site elsewhere.
    await expect(poolStub.siteMove({ protocol: POOL_PROTOCOL, siteId: SITE, op: { op: 'purgeFiles' } })).rejects.toThrow(/left behind by a move/)
    expect(buckets.pool.data.size).toBe(1)
  })
})
