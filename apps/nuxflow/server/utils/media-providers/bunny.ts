import type { MediaProvider, UploadResult } from './index'

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
      `https://storage.bunnycdn.com/${this.storageZone}/${key}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: this.apiKey,
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      },
    )

    if (!res.ok) throw new Error(`Bunny.net upload failed: ${res.status}`)

    return {
      url: `https://${this.pullZone}.b-cdn.net/${key}`,
      storageKey: key,
      provider: 'bunny',
    }
  }

  async delete(storageKey: string): Promise<void> {
    const res = await fetch(`https://storage.bunnycdn.com/${this.storageZone}/${storageKey}`, {
      method: 'DELETE',
      headers: { AccessKey: this.apiKey },
    })
    // Without this check (mirroring upload()'s own res.ok check above), a failed
    // provider-side delete (bad key, revoked AccessKey, 5xx) is silently swallowed, the
    // caller deletes the D1 row anyway, and the blob orphans in storage with no error
    // surfaced anywhere.
    if (!res.ok) throw new Error(`Bunny.net delete failed: ${res.status}`)
  }

  getUrl(storageKey: string): string {
    return `https://${this.pullZone}.b-cdn.net/${storageKey}`
  }
}
