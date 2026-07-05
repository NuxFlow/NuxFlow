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
  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const imagesToken = await resolveSetting(event, 'cloudflare.images_token', 'cloudflareImagesToken')
  const deliveryUrl = await resolveSetting(event, 'cloudflare.images_delivery_url', 'cloudflareImagesDeliveryUrl')

  if (imagesToken && accountId) {
    return new CloudflareImagesProvider(accountId, imagesToken, deliveryUrl)
  }

  // S3 and Bunny are resolved the same way as Cloudflare Images above — per-site DB
  // setting first, environment variable fallback — so a multi-site install can give
  // different sites different buckets/zones, not just a single global env var shared
  // by every site.
  const s3Bucket = await resolveSetting(event, 'media.s3_bucket', 's3Bucket')
  if (s3Bucket) {
    return new S3Provider({
      bucket: s3Bucket,
      accessKey: await resolveSetting(event, 'media.s3_access_key', 's3AccessKey'),
      secretKey: await resolveSetting(event, 'media.s3_secret_key', 's3SecretKey'),
      region: await resolveSetting(event, 'media.s3_region', 's3Region'),
      endpoint: await resolveSetting(event, 'media.s3_endpoint', 's3Endpoint'),
      publicUrl: await resolveSetting(event, 'media.s3_public_url', 's3PublicUrl'),
    })
  }

  const bunnyApiKey = await resolveSetting(event, 'media.bunny_api_key', 'bunnyApiKey')
  if (bunnyApiKey) {
    return new BunnyProvider({
      apiKey: bunnyApiKey,
      storageZone: await resolveSetting(event, 'media.bunny_storage_zone', 'bunnyStorageZone'),
      pullZone: await resolveSetting(event, 'media.bunny_pull_zone', 'bunnyPullZone'),
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
