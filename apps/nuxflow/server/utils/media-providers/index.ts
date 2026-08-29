import type { H3Event } from 'h3'
import { CloudflareImagesProvider } from './cloudflare-images'
import { S3Provider } from './s3'
import { BunnyProvider } from './bunny'
import { resolveSetting } from '../settings'

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
}

// The local fallback stores the file as a base64 data: URI directly in the media.url
// D1 column — there is no real object storage backing it. Kept small and conservative;
// this path exists only so uploads don't hard-fail before a real provider is configured,
// not as a supported way to serve normal-sized media.
const LOCAL_PROVIDER_MAX_BYTES = 512 * 1024

export async function getActiveProvider(event: H3Event): Promise<MediaProvider> {
  // All candidate providers' settings are resolved up front in parallel —
  // each resolveSetting() call is its own D1 round trip (until the 30s
  // per-isolate cache warms up), and none of these values depend on each
  // other, so there's no reason to pay for them one at a time.
  const [
    accountId, imagesToken, deliveryUrl,
    s3Bucket, s3AccessKey, s3SecretKey, s3Region, s3Endpoint, s3PublicUrl,
    bunnyApiKey, bunnyStorageZone, bunnyPullZone,
  ] = await Promise.all([
    resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId'),
    resolveSetting(event, 'cloudflare.images_token', 'cloudflareImagesToken'),
    resolveSetting(event, 'cloudflare.images_delivery_url', 'cloudflareImagesDeliveryUrl'),
    resolveSetting(event, 'media.s3_bucket', 's3Bucket'),
    resolveSetting(event, 'media.s3_access_key', 's3AccessKey'),
    resolveSetting(event, 'media.s3_secret_key', 's3SecretKey'),
    resolveSetting(event, 'media.s3_region', 's3Region'),
    resolveSetting(event, 'media.s3_endpoint', 's3Endpoint'),
    resolveSetting(event, 'media.s3_public_url', 's3PublicUrl'),
    resolveSetting(event, 'media.bunny_api_key', 'bunnyApiKey'),
    resolveSetting(event, 'media.bunny_storage_zone', 'bunnyStorageZone'),
    resolveSetting(event, 'media.bunny_pull_zone', 'bunnyPullZone'),
  ])

  if (imagesToken && accountId) {
    return new CloudflareImagesProvider(accountId, imagesToken, deliveryUrl)
  }

  // S3 and Bunny are resolved the same way as Cloudflare Images above — per-site DB
  // setting first, environment variable fallback — so a multi-site install can give
  // different sites different buckets/zones, not just a single global env var shared
  // by every site.
  if (s3Bucket) {
    return new S3Provider({
      bucket: s3Bucket,
      accessKey: s3AccessKey,
      secretKey: s3SecretKey,
      region: s3Region,
      endpoint: s3Endpoint,
      publicUrl: s3PublicUrl,
    })
  }

  if (bunnyApiKey) {
    return new BunnyProvider({
      apiKey: bunnyApiKey,
      storageZone: bunnyStorageZone,
      pullZone: bunnyPullZone,
    })
  }

  return {
    name: 'local',
    async upload(file) {
      if (file.size > LOCAL_PROVIDER_MAX_BYTES) {
        throw createError({
          statusCode: 413,
          message: `File too large for the local storage fallback (max ${Math.floor(LOCAL_PROVIDER_MAX_BYTES / 1024)} KB — it's stored as base64 directly in the database with no real provider configured). Configure Cloudflare Images, S3, or Bunny.net in Settings → Media for normal-sized uploads.`,
        })
      }
      const buf = await file.arrayBuffer()
      const b64 = Buffer.from(buf).toString('base64')
      const url = `data:${file.type};base64,${b64}`
      return { url, storageKey: file.name, provider: 'local' }
    },
    async delete() {},
    getUrl(key) { return key },
  }
}
