import type { H3Event } from 'h3'
import { CloudflareImagesProvider } from './cloudflare-images'
import { R2Provider } from './r2'
import { resolveStringSetting } from '../settings'
import { getCfBindings } from '../cf-env'
import { eventForSite } from '../site-info'
import { httpError } from '../response'

export interface UploadResult {
  url: string
  storageKey: string
  provider: string
}

export interface MediaProvider {
  name: string
  upload(file: File, key: string, siteId: string): Promise<UploadResult>
  delete(storageKey: string): Promise<void>
  getUrl(storageKey: string): string
  /**
   * Optional cheap existence check for a just-uploaded object (R2 implements it via
   * head()). Used by the move-to-storage migration (media-migration.ts) to confirm a
   * copy really landed before the database copy is dropped; providers without it are
   * verified by fetching their public URL instead.
   */
  exists?(storageKey: string): Promise<boolean>
}

// Percent-encodes a storage key for safe inclusion in a URL path, one segment at a time
// (not the whole key as one component) so a `/` still acts as a path separator rather
// than being escaped itself. Not currently exploitable — the key is always a validated
// ULID + allowlisted extension (see upload.post.ts) — but guards any future key format
// that isn't purely URL-safe characters. Used by the HTTP-based Cloudflare Images
// provider; R2 never needs it since it addresses objects via the R2Bucket binding
// directly, not a URL path.
export function encodeStorageKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

// Every HTTP-based provider's upload()/delete() must surface a failed request rather
// than let the caller silently proceed as if it succeeded — a swallowed upload failure
// would report success with no blob behind it, and a swallowed delete failure orphans
// the blob while the D1 row is removed anyway. `allow404` additionally treats "already
// gone" as success for delete(): the desired end state (no blob in storage) is already
// true, and without it a blob removed out-of-band (a prior partial failure, a manual
// deletion in the provider's own dashboard) makes the D1 row permanently un-deletable
// through the admin UI, since every retry would 404 and fail the same way forever.
/**
 * SVG is the one allowlisted media type that can carry script when opened as a document.
 * It's sanitized on upload (sanitizeSvg), and additionally stored with
 * `Content-Disposition: attachment` wherever the provider lets us set it (R2), so
 * navigating straight to the file downloads it instead of rendering it on the media
 * origin. `<img>`/CSS usage ignores Content-Disposition, so embedding is unaffected.
 */
export function contentDispositionFor(mimeType: string): string | undefined {
  return mimeType === 'image/svg+xml' ? 'attachment' : undefined
}

export async function assertProviderOk(res: Response, operationLabel: string, opts: { allow404?: boolean } = {}): Promise<void> {
  if (res.ok) return
  if (opts.allow404 && res.status === 404) return
  const body = await res.text().catch(() => '')
  throw new Error(`${operationLabel} failed: ${res.status}${body ? ` ${body}` : ''}`)
}

/**
 * Why there's no database fallback: images used to be stored as base64 `data:` URIs in
 * D1 when no bucket was bound. That filled a 10 GB-capped database about 50x more
 * expensive per GB than R2, put every image inside the page HTML (no browser caching,
 * re-sent on every view) and capped files at 512 KB. NuxFlow needs the Workers Paid
 * plan anyway, so R2 is always available — every upload path now refuses instead.
 */
export const STORAGE_REQUIRED_MESSAGE = "Images and files need file storage, which this site doesn't have yet. Add an R2 bucket (the MEDIA_BUCKET binding in wrangler.toml) and redeploy — there's nothing to fill in afterwards."

/** The 409 every path that stores a file throws when the site has no file storage. */
export function storageRequiredError(): never {
  throw httpError({ status: 409, message: STORAGE_REQUIRED_MESSAGE, data: { code: 'storage_required' } })
}

/** The provider new uploads go to, or null when the site has no file storage. */
export async function findMediaProvider(event: H3Event): Promise<MediaProvider | null> {
  // All candidate providers' settings are resolved up front in parallel —
  // each resolveSetting() call is its own D1 round trip (until the 30s
  // per-isolate cache warms up), and none of these values depend on each
  // other, so there's no reason to pay for them one at a time.
  const [
    accountId, imagesToken, deliveryUrl,
    r2PublicUrl,
  ] = await Promise.all([
    resolveStringSetting(event, 'cloudflare.account_id', 'cloudflareAccountId'),
    resolveStringSetting(event, 'cloudflare.images_token', 'cloudflareImagesToken'),
    resolveStringSetting(event, 'cloudflare.images_delivery_url', 'cloudflareImagesDeliveryUrl'),
    resolveStringSetting(event, 'media.r2_public_url', 'r2PublicUrl'),
  ])

  // deliveryUrl is required alongside the token/account — without it, getUrl() builds a
  // broken relative-path URL (`${deliveryUrl}/${storageKey}/public`) for every uploaded
  // image with no error at upload time.
  if (imagesToken && accountId && deliveryUrl) {
    return new CloudflareImagesProvider(accountId, imagesToken, deliveryUrl)
  }

  // R2 is Cloudflare's own object storage (zero egress fees, no third-party account),
  // through the MEDIA_BUCKET binding. With a public URL (a custom domain or the bucket's
  // r2.dev subdomain) browsers fetch objects straight from R2; without one, objects are
  // served through this Worker at /_nuxflow/media/<key> (server/routes/_nuxflow/media/),
  // so having the bucket bound is all it takes for real media storage.
  const { r2 } = getCfBindings(event)
  if (r2) {
    return new R2Provider({ bucket: r2, publicUrl: r2PublicUrl || null })
  }

  return null
}

/** The provider new uploads go to; 409 `storage_required` when the site has none. */
export async function getActiveProvider(event: H3Event): Promise<MediaProvider> {
  return (await findMediaProvider(event)) ?? storageRequiredError()
}

/** Whether this site can store files at all. */
export async function hasMediaStorage(event: H3Event): Promise<boolean> {
  return (await findMediaProvider(event)) !== null
}

/**
 * The provider a *given* site would upload to ('none' without file storage) — getActiveProvider() for a site other than
 * the one this request is for (the Super Admin → Database page reports on every site).
 * resolveSetting() reads the site from event.context, so this evaluates against a
 * prototype-linked copy of the event with only `context.siteId` swapped.
 */
export async function getActiveProviderNameForSite(event: H3Event, siteId: string): Promise<string> {
  return (await findMediaProvider(eventForSite(event, siteId)))?.name ?? 'none'
}
