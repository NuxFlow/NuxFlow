/**
 * Integration tests for Web Push: the admin/user routes under /api/v1/push and the
 * hand-rolled VAPID + RFC 8291 (aes128gcm) implementation in server/utils/webpush.ts.
 *
 * The crypto is verified end to end rather than by snapshot: the test plays the
 * browser, generating a real subscriber ECDH keypair + auth secret, lets webpush.ts
 * encrypt to it, then decrypts the captured request body per RFC 8291/8188 and checks
 * the VAPID JWT's ES256 signature against the site's public key.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { pushSubscriptions, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { resolveSetting } from '../../server/utils/settings'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: vapidKeysHandler } = await import('../../server/api/v1/push/vapid-keys.post')
const { default: vapidPublicHandler } = await import('../../server/api/v1/push/vapid-public-key.get')
const { default: statusHandler } = await import('../../server/api/v1/push/status.get')
const { default: subscribersHandler } = await import('../../server/api/v1/push/subscribers.get')
const { default: unsubscribeHandler } = await import('../../server/api/v1/push/unsubscribe.delete')
const { default: testHandler } = await import('../../server/api/v1/push/test.post')
const { default: broadcastHandler } = await import('../../server/api/v1/push/broadcast.post')
const { sendPushToUser } = await import('../../server/utils/webpush')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-push-01'
const OTHER = 'site-push-02'
let adminId: string
let memberId: string

// ── base64url / crypto helpers (the "browser" side) ───────────────────────────
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))
  return Uint8Array.from(b, c => c.charCodeAt(0))
}
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}
const expand = async (prk: Uint8Array, info: Uint8Array, len: number) => (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len)

interface Subscriber { endpoint: string; p256dh: string; auth: string; privateKey: CryptoKey; publicRaw: Uint8Array; authSecret: Uint8Array }

async function makeSubscriber(endpoint: string): Promise<Subscriber> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const authSecret = crypto.getRandomValues(new Uint8Array(16))
  return { endpoint, p256dh: b64u(publicRaw), auth: b64u(authSecret), privateKey: kp.privateKey, publicRaw, authSecret }
}

/** RFC 8291 §3 + RFC 8188 decryption, as a user agent would do it. */
async function decrypt(sub: Subscriber, body: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  expect(rs).toBe(4096)
  expect(idlen).toBe(65)

  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.privateKey, 256))
  const enc = new TextEncoder()
  const prkKey = await hmac(sub.authSecret, shared)
  const ikm = await expand(prkKey, cat(enc.encode('WebPush: info\0'), sub.publicRaw, asPublic), 32)
  const prk = await hmac(salt, ikm)
  const cek = await expand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await expand(prk, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext))
  // Strip RFC 8188 padding: last non-zero byte is the delimiter, 0x02 for the final record.
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  expect(padded[end]).toBe(2)
  return new TextDecoder().decode(padded.slice(0, end))
}

async function verifyVapid(authHeader: string, endpoint: string, vapidPublic: string) {
  const m = authHeader.match(/^vapid t=([^,]+),k=(.+)$/)
  expect(m).not.toBeNull()
  const [, jwt, k] = m!
  expect(k).toBe(vapidPublic)
  const [h, p, s] = jwt.split('.')
  const pub = await crypto.subtle.importKey('raw', unb64u(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(s), new TextEncoder().encode(`${h}.${p}`))
  expect(valid).toBe(true)
  const header = JSON.parse(new TextDecoder().decode(unb64u(h)))
  const claims = JSON.parse(new TextDecoder().decode(unb64u(p)))
  expect(header).toEqual({ typ: 'JWT', alg: 'ES256' })
  const u = new URL(endpoint)
  expect(claims.aud).toBe(`${u.protocol}//${u.host}`)
  expect(claims.exp).toBeGreaterThan(Date.now() / 1000)
  expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 3600)
  expect(claims.sub).toMatch(/^(mailto:|https:)/)
}

// ── fetch capture ──────────────────────────────────────────────────────────────
interface Captured { url: string; headers: Record<string, string>; body: Uint8Array }
let sent: Captured[] = []
let pushStatus = 201
const realFetch = globalThis.fetch

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'push.localhost' })
  await seedSite(db, { id: OTHER, domain: 'push2.localhost' })
  adminId = await seedUser(db, { email: 'admin@push.test' })
  memberId = await seedUser(db, { email: 'member@push.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, memberId, SITE, 'member')
  await seedRole(db, memberId, OTHER, 'member')
})
afterAll(teardownTestDb)
beforeEach(() => {
  sent = []
  pushStatus = 201
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: new Uint8Array(init?.body as ArrayBuffer),
    })
    return new Response(null, { status: pushStatus })
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch })

function ev(userId: string, opts: { siteId?: string; body?: unknown } = {}) {
  return createMockEvent({
    siteId: opts.siteId ?? SITE,
    session: { user: { id: userId, name: 'U', email: 'u@example.com' } },
    body: opts.body,
  }) as unknown as H3Event
}

async function addSub(userId: string, sub: Pick<Subscriber, 'endpoint' | 'p256dh' | 'auth'>, siteId = SITE) {
  const id = ulid()
  await getCurrentTestDb().insert(pushSubscriptions).values({ id, siteId, userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth })
  return id
}

describe('VAPID key management', () => {
  it('is admin-only', async () => {
    await expect((vapidKeysHandler as Handler)(ev(memberId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rotates keys, stores the private key encrypted, and invalidates this site\'s subscriptions only', async () => {
    await addSub(memberId, { endpoint: 'https://push.example.com/a', p256dh: 'x', auth: 'y' })
    const foreign = await addSub(memberId, { endpoint: 'https://push.example.com/b', p256dh: 'x', auth: 'y' }, OTHER)

    const res = await (vapidKeysHandler as Handler)(ev(adminId)) as { publicKey: string; invalidatedSubscriptions: number }
    expect(unb64u(res.publicKey)).toHaveLength(65)
    expect(res.invalidatedSubscriptions).toBe(1)

    const db = getCurrentTestDb()
    const stored = await db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, SITE), eq(siteSettings.key, 'push.vapid_private_key')),
    })
    expect(String(stored?.value)).not.toContain('"d"')
    const priv = JSON.parse(await resolveSetting(ev(adminId), 'push.vapid_private_key') as string)
    expect(priv).toMatchObject({ kty: 'EC', crv: 'P-256' })
    expect(await db.query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.id, foreign) })).toBeDefined()

    expect(await (vapidPublicHandler as Handler)(ev(memberId))).toEqual({ publicKey: res.publicKey })
  })
})

describe('test decryptor', () => {
  // Pins the browser-side decryptor above to RFC 8291 Appendix A, so the round-trip
  // test below can't pass against an implementation that is merely self-consistent.
  it('decrypts the RFC 8291 Appendix A example', async () => {
    const publicRaw = unb64u('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4')
    const privateKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
      x: b64u(publicRaw.slice(1, 33)), y: b64u(publicRaw.slice(33, 65)),
    }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    const sub = { endpoint: '', p256dh: '', auth: '', privateKey, publicRaw, authSecret: unb64u('BTBZMqHH6r4Tts7J_aSIgg') }
    const body = unb64u('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
    expect(await decrypt(sub, body)).toBe('When I grow up, I want to be a watermelon')
  })
})

describe('delivery', () => {
  let vapidPublic: string

  beforeAll(async () => {
    const res = await (vapidKeysHandler as Handler)(ev(adminId)) as { publicKey: string }
    vapidPublic = res.publicKey
  })

  it('encrypts a payload the subscriber can decrypt, with a valid VAPID JWT', async () => {
    const sub = await makeSubscriber('https://fcm.googleapis.com/fcm/send/abc123')
    await addSub(memberId, sub)

    await sendPushToUser(ev(memberId), memberId, { title: 'Hello', body: 'World', url: '/admin' })

    expect(sent).toHaveLength(1)
    const req = sent[0]
    expect(req.url).toBe(sub.endpoint)
    expect(req.headers['content-encoding']).toBe('aes128gcm')
    expect(req.headers.ttl).toBe('86400')
    await verifyVapid(req.headers.authorization, sub.endpoint, vapidPublic)
    expect(JSON.parse(await decrypt(sub, req.body))).toEqual({ title: 'Hello', body: 'World', url: '/admin' })
  })

  it('prunes a subscription the push service reports as gone', async () => {
    const sub = await makeSubscriber('https://updates.push.services.mozilla.com/wpush/v2/gone')
    const id = await addSub(adminId, sub)
    pushStatus = 410
    await (testHandler as Handler)(ev(adminId))
    expect(await getCurrentTestDb().query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.id, id) })).toBeUndefined()
  })

  it('never sends to a private-network endpoint, and prunes it', async () => {
    const sub = await makeSubscriber('https://169.254.169.254/latest/meta-data')
    const id = await addSub(adminId, sub)
    await sendPushToUser(ev(adminId), adminId, { title: 't', body: 'b' })
    expect(sent.find(s => s.url.includes('169.254'))).toBeUndefined()
    expect(await getCurrentTestDb().query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.id, id) })).toBeUndefined()
  })

  it('broadcast reaches every subscriber on this site only, and is admin-only', async () => {
    const db = getCurrentTestDb()
    await db.delete(pushSubscriptions)
    const a = await makeSubscriber('https://fcm.googleapis.com/fcm/send/a')
    const b = await makeSubscriber('https://fcm.googleapis.com/fcm/send/b')
    const foreign = await makeSubscriber('https://fcm.googleapis.com/fcm/send/foreign')
    await addSub(adminId, a)
    await addSub(memberId, b)
    await addSub(memberId, foreign, OTHER)

    await expect((broadcastHandler as Handler)(ev(memberId, { body: { title: 'x', body: 'y' } }))).rejects.toMatchObject({ statusCode: 403 })

    await (broadcastHandler as Handler)(ev(adminId, { body: { title: 'News', body: 'Out now' } }))
    expect(sent.map(s => s.url).sort()).toEqual([a.endpoint, b.endpoint].sort())
    expect(JSON.parse(await decrypt(b, sent.find(s => s.url === b.endpoint)!.body))).toMatchObject({ title: 'News' })
  })

  it('is a silent no-op when no VAPID keys are configured', async () => {
    await addSub(memberId, await makeSubscriber('https://fcm.googleapis.com/fcm/send/nokeys'), OTHER)
    await sendPushToUser(ev(memberId, { siteId: OTHER }), memberId, { title: 't', body: 'b' })
    expect(sent).toEqual([])
  })
})

describe('subscription status and unsubscribe', () => {
  it('reports status per site and counts subscribers for admins only', async () => {
    const db = getCurrentTestDb()
    await db.delete(pushSubscriptions)
    await addSub(memberId, { endpoint: 'https://fcm.googleapis.com/fcm/send/s', p256dh: 'x', auth: 'y' })

    expect(await (statusHandler as Handler)(ev(memberId))).toEqual({ subscribed: true })
    expect(await (statusHandler as Handler)(ev(adminId))).toEqual({ subscribed: false })
    await expect((subscribersHandler as Handler)(ev(memberId))).rejects.toMatchObject({ statusCode: 403 })
    expect(await (subscribersHandler as Handler)(ev(adminId))).toEqual({ count: 1 })
  })

  it('unsubscribing on one site leaves the same browser subscribed on the user\'s other sites', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/shared-browser'
    const here = await addSub(memberId, { endpoint, p256dh: 'x', auth: 'y' }, SITE)
    const there = await addSub(memberId, { endpoint, p256dh: 'x', auth: 'y' }, OTHER)

    await (unsubscribeHandler as Handler)(ev(memberId, { body: { endpoint } }))

    const db = getCurrentTestDb()
    expect(await db.query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.id, here) })).toBeUndefined()
    expect(await db.query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.id, there) })).toBeDefined()
  })

  it('cannot remove another user\'s subscription', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/admins'
    const id = await addSub(adminId, { endpoint, p256dh: 'x', auth: 'y' })
    await (unsubscribeHandler as Handler)(ev(memberId, { body: { endpoint } }))
    expect(await getCurrentTestDb().query.pushSubscriptions.findFirst({ where: eq(pushSubscriptions.id, id) })).toBeDefined()
  })
})
