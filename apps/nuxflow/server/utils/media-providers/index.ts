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

export async function getActiveProvider(event: H3Event): Promise<MediaProvider> {
  const accountId = await resolveSetting(event, 'cloudflare.account_id', 'cloudflareAccountId')
  const imagesToken = await resolveSetting(event, 'cloudflare.images_token', 'cloudflareImagesToken')
  const deliveryUrl = await resolveSetting(event, 'cloudflare.images_delivery_url', 'cloudflareImagesDeliveryUrl')

  if (imagesToken && accountId) {
    return new CloudflareImagesProvider(accountId, imagesToken, deliveryUrl)
  }
  if (process.env.S3_BUCKET) {
    return new S3Provider()
  }
  if (process.env.BUNNY_API_KEY) {
    return new BunnyProvider()
  }

  return {
    name: 'local',
    async upload(file) {
      const buf = await file.arrayBuffer()
      const b64 = Buffer.from(buf).toString('base64')
      const url = `data:${file.type};base64,${b64}`
      return { url, storageKey: file.name, provider: 'local' }
    },
    async delete() {},
    getUrl(key) { return key },
  }
}
