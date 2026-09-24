import type { H3Event } from 'h3'
import { useDb } from './db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { eq, and } from 'drizzle-orm'
import { resolveSetting } from './settings'
import { isSafeUrl } from './ssrf'

// ─── Base64url ────────────────────────────────────────────────────────────────

function toBase64Url(buf: ArrayBuffer): string {
  let str = ''
  for (const b of new Uint8Array(buf)) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Returns Uint8Array<ArrayBuffer> which satisfies Web Crypto's BufferSource requirement.
function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

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

  // CEK and nonce (RFC 8188 aes128gcm derivation)
  const prk2 = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk2, new Uint8Array(enc.encode('Content-Encoding: aes128gcm\x00\x01').buffer), 16)
  const nonce = await hkdfExpand(prk2, new Uint8Array(enc.encode('Content-Encoding: nonce\x00\x01').buffer), 12)

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

async function dispatchPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  // Subscription endpoints are browser-push-service URLs (FCM/Mozilla autopush/etc.) supplied
  // by the client at subscribe time — an attacker-controlled endpoint pointed at an internal
  // host would make this Worker issue an authenticated-looking request on their behalf (SSRF).
  // Guard here too, not just at subscribe time, so a row written before this check existed
  // (or written by any other path) can't be used to reach an internal address.
  if (!isSafeUrl(endpoint)) throw new SubscriptionExpiredError()

  const subject = `mailto:noreply@${new URL(endpoint).hostname}`
  const jwt = await buildVapidJwt(endpoint, vapidPrivateKey, subject)
  const body = await encryptPayload(p256dh, auth, JSON.stringify(payload))

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': `vapid t=${jwt},k=${vapidPublicKey}`,
      'TTL': '86400',
    },
    body,
  })

  if (res.status === 404 || res.status === 410) throw new SubscriptionExpiredError()

  if (!res.ok && res.status !== 201) {
    console.error(`[webpush] Push failed: ${res.status} ${await res.text()}`)
  }
}

// ─── Helpers that load VAPID keys from site settings ─────────────────────────

async function getVapidKeys(event: H3Event): Promise<{ pub: string; priv: string } | null> {
  const [pub, priv] = await Promise.all([
    resolveSetting(event, 'push.vapid_public_key'),
    resolveSetting(event, 'push.vapid_private_key'),
  ])
  if (!pub || !priv) return null
  return { pub, priv }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendPushToUser(event: H3Event, userId: string, payload: PushPayload): Promise<void> {
  const vapid = await getVapidKeys(event)
  if (!vapid) return

  const siteId = event.context.siteId as string
  const db = useDb(event)
  const subs = await db.select().from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.siteId, siteId), eq(pushSubscriptions.userId, userId)))

  await Promise.allSettled(subs.map(sub =>
    dispatchPush(sub.endpoint, sub.p256dh, sub.auth, payload, vapid.pub, vapid.priv)
      .catch(async (err) => {
        if (err instanceof SubscriptionExpiredError) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        }
      }),
  ))
}

export async function broadcastPushToSite(event: H3Event, payload: PushPayload): Promise<void> {
  const vapid = await getVapidKeys(event)
  if (!vapid) return

  const siteId = event.context.siteId as string
  const db = useDb(event)
  const subs = await db.select().from(pushSubscriptions)
    .where(eq(pushSubscriptions.siteId, siteId))

  await Promise.allSettled(subs.map(sub =>
    dispatchPush(sub.endpoint, sub.p256dh, sub.auth, payload, vapid.pub, vapid.priv)
      .catch(async (err) => {
        if (err instanceof SubscriptionExpiredError) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        }
      }),
  ))
}
