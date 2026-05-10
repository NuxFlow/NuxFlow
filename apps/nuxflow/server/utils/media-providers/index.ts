import { CloudflareImagesProvider } from './cloudflare-images'
import { S3Provider } from './s3'
import { BunnyProvider } from './bunny'

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

export function getActiveProvider(): MediaProvider {
  const config = useRuntimeConfig()

  if (config.cloudflareImagesToken && config.cloudflareAccountId) {
    return new CloudflareImagesProvider()
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
