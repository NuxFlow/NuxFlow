import type { H3Event } from 'h3'
import { useDb } from './db'
import { pushSubscriptions, sites } from '@nuxflow/db/schema'
import { eq, and } from 'drizzle-orm'
import { resolveSetting } from './settings'
import { base64ToBytes, bytesToBase64Url } from '../../shared/lib/base64'
import { requireSiteId } from './site-context'

// ─── Push services ────────────────────────────────────────────────────────────
// A subscription's endpoint comes from the browser, so it's attacker-controlled: any
// signed-in member could register a URL on any host and make every broadcast send this
// Worker there (an amplifier, and a way to burn the per-request subrequest budget the
// real subscribers need). Only the browser vendors' push services are accepted — they
// are the only hosts a real PushSubscription ever points at. Being public hostnames,
// this also rules out every private/loopback address the old isSafeUrl() check covered.
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Brave, Opera, Samsung Internet
  'android.googleapis.com', // older Chrome subscriptions
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari (macOS, iOS home-screen apps)
]
const PUSH_SERVICE_SUFFIXES = [
  '.push.apple.com',
  '.notify.windows.com', // legacy Edge / Windows (WNS)
  '.push.services.mozilla.com',
]

export function isKnownPushService(endpoint: string): boolean {
  let url: URL
  try { url = new URL(endpoint) } catch { return false }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_SUFFIXES.some(s => host.endsWith(s))
}

// ─── Base64url ────────────────────────────────────────────────────────────────

const toBase64Url = bytesToBase64Url
const fromBase64Url = base64ToBytes

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

// ─── HKDF primitives via HMAC-SHA-256 ────────────────────────────────────────
// RFC 5869: Extract = HMAC(key=salt, data=ikm), Expand = HMAC(key=prk, data=info||0x01)[0:L]
// L is always ≤ 32 bytes here so a single T(1) round suffices.

async function hkdfExtract(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm))
}

async function hkdfExpand(prk: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const t1 = new Uint8Array(await crypto.subtle.sign('HMAC', key, concat(info, new Uint8Array([1]))))
  return new Uint8Array(t1.buffer.slice(0, length))
}

// ─── VAPID key generation ─────────────────────────────────────────────────────

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  return {
    publicKey: toBase64Url(publicKeyBuffer),       // 65-byte uncompressed P-256 point
    privateKey: JSON.stringify(privateKeyJwk),      // full JWK, stored encrypted
  }
}

// ─── VAPID JWT (RFC 8030 §8.2, ES256) ────────────────────────────────────────

async function buildVapidJwt(endpoint: string, privateKeyJson: string, subject: string): Promise<string> {
  const jwk = JSON.parse(privateKeyJson) as JsonWebKey
  const signingKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  )
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`
  const enc = new TextEncoder()
  const headerB64 = toBase64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).buffer)
  const payloadB64 = toBase64Url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200,  // 12 hours
    sub: subject,
  })).buffer)
  const sigData = enc.encode(`${headerB64}.${payloadB64}`)
  const sigBuffer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, sigData)
  return `${headerB64}.${payloadB64}.${toBase64Url(sigBuffer)}`
}

// ─── Payload encryption (RFC 8291 §3, aes128gcm) ─────────────────────────────

async function encryptPayload(p256dh: string, auth: string, payload: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const subscriberPublicKeyBytes = fromBase64Url(p256dh)
  const authSecret = fromBase64Url(auth)
  const plaintext = new Uint8Array(enc.encode(payload).buffer)

  // Ephemeral server ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey))

  // Import subscriber public key for ECDH
  const subscriberKey = await crypto.subtle.importKey(
    'raw', subscriberPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberKey },
    serverKeyPair.privateKey, 256,
  ))

  const salt = crypto.getRandomValues(new Uint8Array(16))

  // RFC 8291 §3.4 key combination
  // PRK = HKDF-Extract(auth_secret, shared_secret)
  // IKM = HKDF-Expand(PRK, "WebPush: info\0" || ua_public || as_public, 32)
  const keyInfo = concat(new Uint8Array(enc.encode('WebPush: info\x00').buffer), subscriberPublicKeyBytes, serverPublicKey)
  const prk1 = await hkdfExtract(authSecret, sharedSecret)
  const ikm = await hkdfExpand(prk1, keyInfo, 32)

  // CEK and nonce (RFC 8188 aes128gcm derivation). hkdfExpand() appends the 0x01 counter
  // itself — the info strings end at the 0x00 separator, per RFC 8291 §3.4.
  const prk2 = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk2, new Uint8Array(enc.encode('Content-Encoding: aes128gcm\x00').buffer), 16)
  const nonce = await hkdfExpand(prk2, new Uint8Array(enc.encode('Content-Encoding: nonce\x00').buffer), 12)

  // AES-128-GCM encrypt: pad with delimiter 0x02 (single-record)
  const padded = concat(plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded))

  // aes128gcm header: salt(16) + rs(4 BE) + keylen(1) + serverPublicKey(65)
  const rsBytes = new Uint8Array(4)
  new DataView(rsBytes.buffer).setUint32(0, 4096, false)

  return concat(salt, rsBytes, new Uint8Array([65]), serverPublicKey, ciphertext).buffer
}

// ─── HTTP push dispatch ───────────────────────────────────────────────────────

interface PushPayload {
  title: string
  body: string
  icon?: string
  url?: string
  data?: Record<string, unknown>
}

class SubscriptionExpiredError extends Error {
  constructor() { super('push-subscription-expired') }
}

/** Resolves true when the push service accepted the message. */
async function dispatchPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushPayload,
  vapid: VapidConfig,
): Promise<boolean> {
  // Checked at send time too, not just at subscribe time, so a row written before the
  // allowlist existed (or by any other path) is pruned instead of fetched.
  if (!isKnownPushService(endpoint)) throw new SubscriptionExpiredError()

  const jwt = await buildVapidJwt(endpoint, vapid.priv, vapid.subject)
  const body = await encryptPayload(p256dh, auth, JSON.stringify(payload))

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': `vapid t=${jwt},k=${vapid.pub}`,
      'TTL': '86400',
    },
    body,
  })

  if (res.status === 404 || res.status === 410) throw new SubscriptionExpiredError()

  if (!res.ok) {
    console.error(`[webpush] Push failed: ${res.status} ${await res.text()}`)
    return false
  }
  return true
}

// ─── Helpers that load VAPID keys from site settings ─────────────────────────

interface VapidConfig { pub: string; priv: string; subject: string }

async function getVapidKeys(event: H3Event): Promise<VapidConfig | null> {
  const siteId = requireSiteId(event)
  const [pub, priv, site] = await Promise.all([
    resolveSetting(event, 'push.vapid_public_key'),
    resolveSetting(event, 'push.vapid_private_key'),
    useDb(event).query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
  ])
  if (!pub || !priv) return null
  // The JWT's `sub` is how a push service contacts the sender about problems, so it names
  // this site — it used to be `noreply@<the push service's own host>`, which Apple's
  // service in particular treats as invalid.
  return { pub, priv, subject: `https://${site?.domain ?? 'localhost'}` }
}

/** What happened to one send — the admin UI reports it instead of a blanket "sent". */
export interface PushResult {
  /** Subscriptions tried. */
  total: number
  /** Accepted by the push service. */
  delivered: number
  /** Gone (404/410) or not a push service, so deleted. */
  removed: number
}

async function deliver(event: H3Event, vapid: VapidConfig, subs: (typeof pushSubscriptions.$inferSelect)[], payload: PushPayload): Promise<PushResult> {
  const siteId = requireSiteId(event)
  const db = useDb(event)
  const result: PushResult = { total: subs.length, delivered: 0, removed: 0 }
  await Promise.allSettled(subs.map(sub =>
    dispatchPush(sub.endpoint, sub.p256dh, sub.auth, payload, vapid)
      .then((ok) => { if (ok) result.delivered++ })
      .catch(async (err) => {
        if (err instanceof SubscriptionExpiredError) {
          result.removed++
          await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, sub.id), eq(pushSubscriptions.siteId, siteId)))
        } else {
          console.error('[webpush] Push dispatch failed:', err)
        }
      }),
  ))
  return result
}

const NOTHING_SENT: PushResult = { total: 0, delivered: 0, removed: 0 }

// ─── Public API ───────────────────────────────────────────────────────────────

/** Pushes to every browser `userId` subscribed on the event's site (event.context.siteId). */
export async function sendPushToUser(event: H3Event, userId: string, payload: PushPayload): Promise<PushResult> {
  const vapid = await getVapidKeys(event)
  if (!vapid) return NOTHING_SENT

  const siteId = requireSiteId(event)
  const subs = await useDb(event).select().from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.siteId, siteId), eq(pushSubscriptions.userId, userId)))
  return deliver(event, vapid, subs, payload)
}

export async function broadcastPushToSite(event: H3Event, payload: PushPayload): Promise<PushResult> {
  const vapid = await getVapidKeys(event)
  if (!vapid) return NOTHING_SENT

  const siteId = requireSiteId(event)
  const subs = await useDb(event).select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.siteId, siteId))
  return deliver(event, vapid, subs, payload)
}
