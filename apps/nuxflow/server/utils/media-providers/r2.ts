import type { MediaProvider, UploadResult } from './index'
import { contentDispositionFor, encodeStorageKey } from './index'
import { WORKER_MEDIA_PREFIX } from '../media-url'

export interface R2ProviderConfig {
  bucket: R2Bucket
  /**
   * Public base URL for the bucket (a custom domain or its r2.dev subdomain). Optional:
   * without one, objects are served through this Worker at `/_nuxflow/media/<key>`
   * (server/routes/_nuxflow/media/[...key].ts), so the MEDIA_BUCKET binding alone is
   * enough for working media storage. A public URL is only a performance option — it
   * lets the browser fetch straight from R2 without a Worker invocation per image.
   */
  publicUrl?: string | null
}

// Cloudflare R2 — zero egress fees, no third-party account, no access keys. Uses the
// bucket binding directly (put()/delete() on the Worker's own R2Bucket object) rather
// than R2's optional S3-compatible API, so there's no HMAC request signing to implement
// (compare to S3Provider) and no credentials to store or leak.
export class R2Provider implements MediaProvider {
  readonly name = 'r2'

  private readonly bucket: R2Bucket
  private readonly publicUrl: string | null

  constructor(config: R2ProviderConfig) {
    this.bucket = config.bucket
    this.publicUrl = config.publicUrl ? config.publicUrl.replace(/\/$/, '') : null
  }

  /** True when objects are served through the Worker rather than a public bucket URL. */
  get servedByWorker(): boolean {
    return this.publicUrl === null
  }

  async upload(file: File, key: string): Promise<UploadResult> {
    const buf = await file.arrayBuffer()
    await this.bucket.put(key, buf, {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
        contentDisposition: contentDispositionFor(file.type),
      },
    })
    return { url: this.getUrl(key), storageKey: key, provider: 'r2' }
  }

  async delete(storageKey: string): Promise<void> {
    await this.bucket.delete(storageKey)
  }

  async exists(storageKey: string): Promise<boolean> {
    return (await this.bucket.head(storageKey)) !== null
  }

  getUrl(storageKey: string): string {
    return this.publicUrl
      ? `${this.publicUrl}/${storageKey}`
      : `${WORKER_MEDIA_PREFIX}${encodeStorageKey(storageKey)}`
  }
}
