import type { MediaProvider, UploadResult } from './index'
import { encodeStorageKey, assertProviderOk } from './index'

export interface BunnyProviderConfig {
  apiKey: string
  storageZone: string
  pullZone: string
}

export class BunnyProvider implements MediaProvider {
  readonly name = 'bunny'

  private readonly apiKey: string
  private readonly storageZone: string
  private readonly pullZone: string

  constructor(config: BunnyProviderConfig) {
    this.apiKey = config.apiKey
    this.storageZone = config.storageZone
    this.pullZone = config.pullZone
  }

  async upload(file: File, key: string): Promise<UploadResult> {
    const buf = await file.arrayBuffer()

    const res = await fetch(
      `https://storage.bunnycdn.com/${this.storageZone}/${encodeStorageKey(key)}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: this.apiKey,
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      },
    )

    await assertProviderOk(res, 'Bunny.net upload')

    // Computed via getUrl() rather than re-deriving the join here — see the identical
    // reasoning in s3.ts's upload().
    return {
      url: this.getUrl(key),
      storageKey: key,
      provider: 'bunny',
    }
  }

  async delete(storageKey: string): Promise<void> {
    const res = await fetch(`https://storage.bunnycdn.com/${this.storageZone}/${encodeStorageKey(storageKey)}`, {
      method: 'DELETE',
      headers: { AccessKey: this.apiKey },
    })
    // allow404: a blob already removed out-of-band (a prior partial failure, manual
    // deletion in the Bunny dashboard) must not permanently block deleting its D1 row —
    // see the shared assertProviderOk doc comment in index.ts. Anything else (bad key,
    // revoked AccessKey, 5xx) still means the object was NOT removed and must throw, or
    // the caller would delete the D1 row anyway and orphan the blob in storage.
    await assertProviderOk(res, 'Bunny.net delete', { allow404: true })
  }

  getUrl(storageKey: string): string {
    return `https://${this.pullZone}.b-cdn.net/${encodeStorageKey(storageKey)}`
  }
}
