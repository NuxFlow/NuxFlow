import type { MediaProvider, UploadResult } from './index'

export interface R2ProviderConfig {
  bucket: R2Bucket
  publicUrl: string
}

// Cloudflare R2 — zero egress fees, no third-party account, no access keys. Uses the
// bucket binding directly (put()/delete() on the Worker's own R2Bucket object) rather
// than R2's optional S3-compatible API, so there's no HMAC request signing to implement
// (compare to S3Provider) and no credentials to store or leak. Requires the bucket to
// have public access enabled via either a custom domain or its r2.dev subdomain — R2
// buckets are private by default, so `publicUrl` must point at whichever of those is
// configured (Settings → Media).
export class R2Provider implements MediaProvider {
  readonly name = 'r2'

  private readonly bucket: R2Bucket
  private readonly publicUrl: string

  constructor(config: R2ProviderConfig) {
    this.bucket = config.bucket
    this.publicUrl = config.publicUrl.replace(/\/$/, '')
  }

  async upload(file: File, key: string): Promise<UploadResult> {
    const buf = await file.arrayBuffer()
    await this.bucket.put(key, buf, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    })
    return { url: this.getUrl(key), storageKey: key, provider: 'r2' }
  }

  async delete(storageKey: string): Promise<void> {
    await this.bucket.delete(storageKey)
  }

  getUrl(storageKey: string): string {
    return `${this.publicUrl}/${storageKey}`
  }
}
