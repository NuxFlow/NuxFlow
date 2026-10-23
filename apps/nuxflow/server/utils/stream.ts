import type { H3Event } from 'h3'
import { and, eq, inArray, or } from 'drizzle-orm'
import { videoAssets } from '@nuxflow/db/schema'
import { findVideoEmbeds, streamEmbedUrl } from '@nuxflow/canvas/video'
import { useDb, type Db } from './db'
import { resolveStringSetting } from './settings'
import { isHostingPlatform } from './hosting-platform'
import { isPrimarySite } from './site-info'
import { getPlatformSetting } from './control-plane'
import { getCfBindings } from './cf-env'
import { decryptText, encryptText } from './encryption'
import { bumpCacheVersion } from './cache-version'
import { errorMessage } from './errors'
import { bytesToBase64, bytesToBase64Url, base64ToBytes } from '../../shared/lib/base64'

/**
 * Cloudflare Stream: whose account a site's videos go into, the REST calls the video
 * routes make, and signed links for private videos.
 *
 * **Accounts.** A site uses its own Stream account when it has one — its Settings → Media
 * values, or the deployment's env vars on an ordinary install (and on the primary site).
 * On a hosting platform those env vars are withheld from customers (settings.ts,
 * HOSTING_PLATFORM_ONLY_ENV_KEYS), so a customer without an account of their own uploads
 * into the operator's — the "platform" account (the primary site's settings or env, pushed
 * to pools as platform settings), counted against the plan's `video` minutes. Each video
 * row records which account holds it (`video_assets.stream_account`), so later calls go to
 * the right one even if the site adds or removes its own credentials.
 *
 * **Private videos** require signed links (Stream's `requireSignedURLs`). Tokens are
 * signed here with a per-account signing key (RS256, Web Crypto) — no API call per view.
 * Keys are created on first use and kept, encrypted, in this Worker's KV: the platform
 * account's under `stream-key:platform:<account>`, a site's own account's under its site
 * id too, so a tenant naming someone else's account id never gets that account's key.
 * Only videos registered to the requesting site (`video_assets`) are ever signed.
 */

export type StreamAccountKind = 'site' | 'platform'

export interface StreamAccount {
  kind: StreamAccountKind
  accountId: string
  token: string
}

export const STREAM_ID_RE = /^[a-f0-9]{32}$/i
/** Stream's own cap on a single upload's length (and what direct uploads allowed before). */
export const MAX_UPLOAD_DURATION_SECONDS = 4 * 60 * 60
/** How long a signed playback link lasts — long enough to watch a full film. Stream allows up to 24 h. */
const PLAYBACK_TOKEN_TTL_SECONDS = 12 * 60 * 60
const API = 'https://api.cloudflare.com/client/v4/accounts'

async function siteStreamAccount(event: H3Event): Promise<StreamAccount | null> {
  const [accountId, token] = await Promise.all([
    resolveStringSetting(event, 'cloudflare.account_id', 'cloudflareAccountId'),
    resolveStringSetting(event, 'cloudflare.stream_token', 'cloudflareStreamToken'),
  ])
  return accountId && token ? { kind: 'site', accountId, token } : null
}

/** The operator's Stream account, for a hosted customer site (never an ordinary install or the primary site). */
async function platformStreamAccount(event: H3Event): Promise<StreamAccount | null> {
  const db = useDb(event)
  if (!(await isHostingPlatform(db))) return null
  if (await isPrimarySite(event, event.context.siteId)) return null
  const [accountId, token] = await Promise.all([
    getPlatformSetting(db, 'cloudflare.account_id'),
    getPlatformSetting(db, 'cloudflare.stream_token'),
  ])
  return accountId && token ? { kind: 'platform', accountId, token } : null
}

/** The account new uploads go into: the site's own, else (hosted customers) the platform's. */
export async function uploadStreamAccount(event: H3Event): Promise<StreamAccount | null> {
  return (await siteStreamAccount(event)) ?? platformStreamAccount(event)
}

/** The account holding an existing video. */
export function streamAccountFor(event: H3Event, kind: StreamAccountKind): Promise<StreamAccount | null> {
  return kind === 'platform' ? platformStreamAccount(event) : siteStreamAccount(event)
}

export function streamNotConfigured(): never {
  throw createError({
    statusCode: 501,
    message: 'Cloudflare Stream is not configured. Add your Account ID and Stream API token in Settings → Media.',
  })
}

// ── REST calls ───────────────────────────────────────────────────────────────

interface StreamEnvelope<T> {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result?: T
}

export interface StreamVideoDetails {
  uid: string
  duration?: number
  thumbnail?: string
  creator?: string | null
  requireSignedURLs?: boolean
  status?: { state: string }
  meta?: Record<string, string>
}

async function streamFetch(account: StreamAccount, path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  try {
    return await fetch(`${API}/${account.accountId}/stream${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${account.token}`, ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    console.error(`[stream] Request to ${path || '/'} failed:`, err)
    throw createError({ statusCode: 502, message: "Couldn't reach Cloudflare Stream. Try again in a moment." })
  }
}

async function readEnvelope<T>(res: Response): Promise<StreamEnvelope<T> | null> {
  return res.json().then(v => v as StreamEnvelope<T>, () => null)
}

/** A video's details, or null when Stream doesn't know it (404). Throws 502 on any other failure. */
export async function getStreamVideo(account: StreamAccount, uid: string): Promise<StreamVideoDetails | null> {
  const res = await streamFetch(account, `/${uid}`)
  if (res.status === 404) return null
  const data = await readEnvelope<StreamVideoDetails>(res)
  if (!res.ok || !data?.success || !data.result) {
    console.error('[stream] Video lookup failed:', res.status, JSON.stringify(data?.errors ?? null))
    throw createError({ statusCode: 502, message: 'Cloudflare Stream returned an error while looking up the video.' })
  }
  return data.result
}

/** Deletes a video. True when it's gone (including already gone); false when Stream refused or couldn't be reached. */
export async function deleteStreamVideo(account: StreamAccount, uid: string): Promise<boolean> {
  try {
    const res = await streamFetch(account, `/${uid}`, { method: 'DELETE' })
    if (res.ok || res.status === 404) return true
    console.error('[stream] Delete failed:', res.status, await res.text().catch(() => ''))
    return false
  } catch {
    return false
  }
}

/** Switches a video's signed-links requirement on or off. Throws 502 when Stream refuses. */
export async function setStreamVideoPrivate(account: StreamAccount, uid: string, isPrivate: boolean): Promise<void> {
  const res = await streamFetch(account, `/${uid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, requireSignedURLs: isPrivate }),
  })
  if (!res.ok) {
    console.error('[stream] Changing privacy failed:', res.status, await res.text().catch(() => ''))
    throw createError({ statusCode: 502, message: `Cloudflare Stream refused to change the video's privacy (HTTP ${res.status}).` })
  }
}

/** tus `Upload-Metadata`: `key base64(value)` pairs joined by commas; a flag is the key alone. */
export function tusMetadata(entries: Record<string, string | number | true | undefined>): string {
  const enc = new TextEncoder()
  return Object.entries(entries)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => (v === true ? k : `${k} ${bytesToBase64(enc.encode(String(v)))}`))
    .join(',')
}

/**
 * Starts a resumable (tus) upload the browser then sends straight to Stream, in chunks —
 * any size up to Stream's 30 GB, and a dropped connection resumes instead of starting
 * over. Stream's plain one-request upload stops at 200 MB, too small for a finished film.
 * `creator` is the site id, which registration checks (index.post.ts).
 */
export async function createStreamUpload(
  account: StreamAccount,
  opts: { size: number; name: string; maxDurationSeconds: number; creator: string },
): Promise<{ uploadUrl: string; uid: string }> {
  const res = await streamFetch(account, '?direct_user=true', {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(opts.size),
      'Upload-Creator': opts.creator,
      'Upload-Metadata': tusMetadata({ name: opts.name, maxDurationSeconds: Math.max(1, Math.floor(opts.maxDurationSeconds)) }),
    },
  })
  const uploadUrl = res.headers.get('Location')
  const uid = res.headers.get('stream-media-id')
  if (res.ok && uploadUrl && uid && STREAM_ID_RE.test(uid) && /^https:\/\/[a-z0-9.-]+\.cloudflarestream\.com\//i.test(uploadUrl)) {
    return { uploadUrl, uid: uid.toLowerCase() }
  }
  const data = await readEnvelope<unknown>(res)
  console.error('[stream] Creating the upload failed:', res.status, JSON.stringify(data?.errors ?? null))
  if (data?.errors?.some(e => e.code === 10011)) {
    throw createError({
      statusCode: 402,
      message: 'This Cloudflare account has no Stream minutes. Buy a Stream plan in the Cloudflare dashboard (Stream → Buy minutes) to upload videos — the Workers Paid plan does not include Stream storage.',
    })
  }
  throw createError({ statusCode: 502, message: data?.errors?.[0]?.message || 'Cloudflare Stream refused to start the upload.' })
}

// ── Signed links ─────────────────────────────────────────────────────────────

interface SigningKey { id: string; key: CryptoKey }

const signingKeys = new Map<string, Promise<SigningKey>>()

function signingKeyKvKey(account: StreamAccount, siteId: string): string {
  return account.kind === 'platform'
    ? `stream-key:platform:${account.accountId}`
    : `stream-key:site:${siteId}:${account.accountId}`
}

function importSigningKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
}

async function loadOrCreateSigningKey(event: H3Event, account: StreamAccount, siteId: string): Promise<SigningKey> {
  const { kv } = getCfBindings(event)
  if (!kv) throw createError({ statusCode: 503, message: 'Private videos need the PLUGIN_KV binding.' })
  const secret = String(useRuntimeConfig().betterAuthSecret)
  const kvKey = signingKeyKvKey(account, siteId)

  const stored = await kv.get(kvKey)
  if (stored) {
    try {
      const { id, jwk } = JSON.parse(await decryptText(stored, secret)) as { id: string; jwk: JsonWebKey }
      return { id, key: await importSigningKey(jwk) }
    } catch (err) {
      // Unreadable (e.g. the auth secret changed): make a new one below.
      console.warn('[stream] Stored signing key unreadable, creating a new one:', errorMessage(err, String(err)))
    }
  }

  const res = await streamFetch(account, '/keys', { method: 'POST' })
  const data = await readEnvelope<{ id: string; jwk: string }>(res)
  if (!res.ok || !data?.success || !data.result?.id || !data.result.jwk) {
    console.error('[stream] Creating a signing key failed:', res.status, JSON.stringify(data?.errors ?? null))
    throw createError({ statusCode: 502, message: 'Cloudflare Stream refused to create a signing key — check that the Stream token can edit Stream.' })
  }
  const jwk = JSON.parse(new TextDecoder().decode(base64ToBytes(data.result.jwk))) as JsonWebKey
  await kv.put(kvKey, await encryptText(JSON.stringify({ id: data.result.id, jwk }), secret))
  return { id: data.result.id, key: await importSigningKey(jwk) }
}

function getSigningKey(event: H3Event, account: StreamAccount, siteId: string): Promise<SigningKey> {
  const cacheKey = signingKeyKvKey(account, siteId)
  let pending = signingKeys.get(cacheKey)
  if (!pending) {
    if (signingKeys.size >= 200) signingKeys.clear()
    pending = loadOrCreateSigningKey(event, account, siteId)
    signingKeys.set(cacheKey, pending)
    pending.catch(() => signingKeys.delete(cacheKey))
  }
  return pending
}

/** A Stream playback token (JWT, RS256) for one video, valid for `ttlSeconds`. */
export async function signStreamToken(signing: SigningKey, uid: string, ttlSeconds = PLAYBACK_TOKEN_TTL_SECONDS, now = Date.now()): Promise<string> {
  const enc = new TextEncoder()
  const iat = Math.floor(now / 1000)
  const header = bytesToBase64Url(enc.encode(JSON.stringify({ alg: 'RS256', kid: signing.id })))
  const payload = bytesToBase64Url(enc.encode(JSON.stringify({ sub: uid, kid: signing.id, exp: iat + ttlSeconds, nbf: iat - 60 })))
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing.key, enc.encode(`${header}.${payload}`))
  return `${header}.${payload}.${bytesToBase64Url(signature)}`
}

/** The `customer-<code>` subdomain of a Stream URL (thumbnails carry it), if present. */
export function streamCustomerCode(url: string | null | undefined): string | null {
  return /^https:\/\/customer-([a-z0-9]+)\.cloudflarestream\.com\//i.exec(url ?? '')?.[1] ?? null
}

type VideoRow = Pick<typeof videoAssets.$inferSelect, 'cloudflareStreamId' | 'streamAccount' | 'thumbnailUrl'>

/** Signed player and thumbnail URLs for a private video registered to `siteId`. */
export async function signedPlayback(event: H3Event, siteId: string, row: VideoRow): Promise<{ playbackUrl: string; thumbnailUrl: string }> {
  const account = await streamAccountFor(event, row.streamAccount)
  if (!account) streamNotConfigured()
  const token = await signStreamToken(await getSigningKey(event, account, siteId), row.cloudflareStreamId)
  const code = streamCustomerCode(row.thumbnailUrl)
  return {
    playbackUrl: streamEmbedUrl(token, {}, code),
    thumbnailUrl: code
      ? `https://customer-${code}.cloudflarestream.com/${token}/thumbnails/thumbnail.jpg`
      : `https://videodelivery.net/${token}/thumbnails/thumbnail.jpg`,
  }
}

// ── Videos on pages ──────────────────────────────────────────────────────────

/** Stream video ids shown on a page — Video blocks, Video galleries and videos in a post. */
export function streamIdsInContent(content: unknown): string[] {
  const ids = new Set<string>()
  for (const embed of findVideoEmbeds(content)) {
    if (embed.ref.provider === 'stream') ids.add(embed.ref.id)
  }
  return [...ids]
}

/** Does Stream need a signed link for this video? Private, or paused by the plan (video-usage.ts). */
export function needsSignedLink(row: { isPrivate: boolean; watchPaused: boolean }): boolean {
  return row.isPrivate || row.watchPaused
}

/**
 * Password and members-only pages make their library videos private: otherwise anyone the
 * video's address is forwarded to could watch it, page password or not. Called after a
 * content save. Best effort per video — a refusal is logged and the video stays public
 * (shown as such in Media → Videos) rather than failing the save.
 */
export async function makePageVideosPrivate(event: H3Event, siteId: string, item: { content: unknown; visibility: string | null }): Promise<number> {
  if (item.visibility !== 'password' && item.visibility !== 'members') return 0
  const ids = streamIdsInContent(item.content)
  if (!ids.length) return 0
  const db = useDb(event)
  const rows = await db.select({ id: videoAssets.id, uid: videoAssets.cloudflareStreamId, streamAccount: videoAssets.streamAccount, watchPaused: videoAssets.watchPaused })
    .from(videoAssets)
    .where(and(eq(videoAssets.siteId, siteId), inArray(videoAssets.cloudflareStreamId, ids), eq(videoAssets.isPrivate, false)))
  let changed = 0
  for (const row of rows) {
    try {
      const account = await streamAccountFor(event, row.streamAccount)
      if (!account) continue
      // A paused video already needs signed links on Stream.
      if (!row.watchPaused) await setStreamVideoPrivate(account, row.uid, true)
      await db.update(videoAssets).set({ isPrivate: true }).where(and(eq(videoAssets.id, row.id), eq(videoAssets.siteId, siteId)))
      changed++
    } catch (err) {
      console.error(`[stream] Couldn't make video ${row.uid} private:`, errorMessage(err, String(err)))
    }
  }
  // Public pages showing the same video are cached with it marked public.
  if (changed) await bumpCacheVersion(event, siteId).catch(() => {})
  return changed
}

/**
 * Marks each Stream video on the page with whether it needs a signed link (private, or
 * paused by the plan) — `privateVideo` on a Video block or post video, `privateVideos` on a
 * Video gallery — so the browser knows to fetch one. Returns new content; never stored.
 */
export async function markPrivateVideos<T>(db: Db, siteId: string, content: T): Promise<T> {
  const ids = streamIdsInContent(content)
  if (!ids.length) return content
  const rows = await db.select({ uid: videoAssets.cloudflareStreamId })
    .from(videoAssets)
    .where(and(eq(videoAssets.siteId, siteId), inArray(videoAssets.cloudflareStreamId, ids), or(eq(videoAssets.isPrivate, true), eq(videoAssets.watchPaused, true))))
  const privateIds = new Set(rows.map(r => r.uid))
  const copy = structuredClone(content)
  for (const embed of findVideoEmbeds(copy)) {
    if (embed.ref.provider === 'stream') embed.mark(privateIds.has(embed.ref.id))
  }
  return copy
}

type AdminVideoRow = typeof videoAssets.$inferSelect

/**
 * A library video as Media → Videos shows it: with a `playbackUrl` for the preview player,
 * and — private videos only — signed player and thumbnail links (their plain ones don't
 * load). A signing failure leaves the plain links, so the library still lists the video.
 */
export async function withAdminPlayback(event: H3Event, siteId: string, row: AdminVideoRow): Promise<AdminVideoRow & { playbackUrl: string }> {
  if (needsSignedLink(row)) {
    try {
      const signed = await signedPlayback(event, siteId, row)
      return { ...row, playbackUrl: signed.playbackUrl, thumbnailUrl: row.thumbnailUrl ? signed.thumbnailUrl : null }
    } catch (err) {
      console.error(`[stream] Couldn't sign video ${row.cloudflareStreamId} for the library:`, errorMessage(err, String(err)))
    }
  }
  return { ...row, playbackUrl: streamEmbedUrl(row.cloudflareStreamId, {}, streamCustomerCode(row.thumbnailUrl)) }
}
